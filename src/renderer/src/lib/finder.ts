/**
 * 찾기(Ctrl+F) 실행기 — 스토어·엔진과 엮인 부분. 순수 로직은 find.ts.
 *
 * 엔진 워커는 하나라 전 쪽 검색을 한 번에 맡기면 그동안 렌더가 멈춘다 → 쪽 구간(FIND_CHUNK_PAGES)
 * 단위로 나눠 호출해 사이사이 렌더 요청이 끼어들게 하고, 결과는 도착하는 대로 누적 표시한다.
 * 새 검색이 시작되면(seq 증가) 이전 루프는 다음 구간 경계에서 스스로 멈춘다.
 */
import { useStore } from '../state/store'
import {
  FIND_CHUNK_PAGES,
  FIND_MAX_HITS,
  firstHitFrom,
  hitTop,
  lastHitUpTo,
  queryFromSelection,
  stepHit
} from './find'
import type { SearchHit } from '../../../shared/types'

const store = (): ReturnType<typeof useStore.getState> => useStore.getState()

/** 입력 후 검색까지 대기 — 타이핑 중 매 글자 검색 방지 */
const TYPE_DEBOUNCE = 220
/** 문서 변경(편집·글자 크기·탭 전환) 후 재검색 대기 — 연속 변경을 한 번으로 */
const RERUN_DEBOUNCE = 150

let seq = 0
/** 마지막으로 실행한 (문서, 검색어) — Enter 때 새 검색이 필요한지 판단 */
let lastRun: { docId: number; query: string } | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function cancelTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function isStale(query: string): boolean {
  const s = store()
  return !lastRun || lastRun.query !== query || lastRun.docId !== s.activeDocId
}

/** 결과로 이동 — 그 쪽의 결과 위치가 보이게 스크롤 */
function moveTo(index: number): void {
  const s = store()
  const hit = s.findHits[index]
  if (!hit) return
  s.set({ findIndex: index })
  s.gotoPageAt(hit.page, hitTop(hit))
}

/**
 * 활성 문서 전체를 검색한다. jump=true면 현재 쪽 이후 첫 결과로 이동(입력·Enter),
 * false면 현재 결과 표시만 갱신(문서 변경 후 재검색 — 화면을 함부로 옮기지 않음).
 */
export async function runFind(query: string, jump: boolean): Promise<void> {
  cancelTimer()
  const my = ++seq
  const s = store()
  const info = s.info
  if (!info || !query.trim()) {
    lastRun = null
    s.set({ findHits: [], findIndex: -1, findStatus: 'idle', findCapped: false })
    return
  }
  const docId = s.activeDocId
  const startPage = s.currentPage
  lastRun = { docId, query }
  s.set({ findHits: [], findIndex: -1, findDocId: docId, findStatus: 'searching', findCapped: false })

  /**
   * 중단 조건 — 더 새로운 검색 / 탭 전환 / 같은 탭의 문서 변경(쪽 편집·재레이아웃: info 교체).
   * 안 멈추면 옛 결과로 새 탭을 이동시키거나, 쪽 번호가 어긋난 옛 결과를 새 결과에 섞는다.
   */
  const superseded = (): boolean => my !== seq || store().activeDocId !== docId || store().info !== info
  /** 현재 결과 지정 — 그 사이 사용자가 Enter/F3로 이미 골랐으면 건드리지 않는다 */
  const pick = (i: number): void => {
    if (store().findIndex >= 0) return
    if (jump) moveTo(i)
    else store().set({ findIndex: i })
  }

  let hits: SearchHit[] = []
  try {
    for (let from = 0; from < info.pageCount && hits.length < FIND_MAX_HITS; from += FIND_CHUNK_PAGES) {
      const r = await window.icepdf.engine(docId, 'search', {
        needle: query,
        from,
        to: from + FIND_CHUNK_PAGES,
        maxHits: FIND_MAX_HITS - hits.length
      })
      if (superseded()) return
      hits = [...hits, ...r.hits]
      store().set({ findHits: hits })
      // 현재 쪽 이후 첫 결과가 나오면 끝까지 기다리지 않고 바로 표시·이동
      const i = hits.findIndex((h) => h.page >= startPage)
      if (i >= 0) pick(i)
    }
    if (superseded()) return
    // 현재 쪽 이후에 결과가 없으면 처음으로 순환
    if (hits.length) pick(firstHitFrom(hits, startPage))
    store().set({ findStatus: 'done', findCapped: hits.length >= FIND_MAX_HITS })
  } catch (err) {
    if (my !== seq) return
    store().set({ findStatus: 'done' })
    store().showToast(`찾기 실패: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Ctrl+F — 찾기 막대 열기. 닫혀 있을 때만 한 줄 선택 텍스트를 검색어로 채운다.
 * 이미 열려 있으면 입력칸만 다시 포커스+전체 선택 (입력한 검색어를 남아 있는 옛 선택으로 덮지 않음).
 */
export function openFind(): void {
  const s = store()
  if (!s.info) return
  const wasOpen = s.findOpen
  const nativeSel = typeof window !== 'undefined' ? window.getSelection()?.toString() : ''
  const prefill = wasOpen ? '' : queryFromSelection(s.selection?.text || nativeSel)
  const query = prefill || s.findQuery
  s.set({ findOpen: true, findQuery: query, findFocusTick: s.findFocusTick + 1 })
  if (query.trim() && (!wasOpen || isStale(query))) void runFind(query, !!prefill)
}

/** 입력칸 변경 — 잠시 멈추면 검색 + 첫 결과로 이동 */
export function setFindQuery(query: string): void {
  store().set({ findQuery: query })
  cancelTimer()
  timer = setTimeout(() => void runFind(query, true), TYPE_DEBOUNCE)
}

/** Enter/F3(다음), Shift+Enter/Shift+F3(이전) */
export function findStep(dir: 1 | -1): void {
  const s = store()
  if (!s.info) return
  if (!s.findOpen) {
    openFind()
    return
  }
  const query = s.findQuery
  if (!query.trim()) return
  // 입력 직후(디바운스 전)나 다른 탭 결과면 새로 검색하며 첫 결과로
  if (isStale(query)) {
    void runFind(query, true)
    return
  }
  const total = s.findHits.length
  if (!total) return
  // 검색 중이고 현재 쪽 이후 결과가 아직 안 왔다 → 앞쪽 결과로 순환 점프하지 말고 기다린다
  // (현재 쪽 이후 결과가 도착하면 실행기가 그리로 이동시킨다)
  if (s.findStatus === 'searching' && s.findIndex < 0) return
  const index =
    s.findIndex < 0
      ? dir === 1
        ? firstHitFrom(s.findHits, s.currentPage)
        : lastHitUpTo(s.findHits, s.currentPage)
      : stepHit(s.findIndex, total, dir)
  moveTo(index)
}

/** Esc/✕ — 막대 닫고 강조 제거 (검색어는 다음에 열 때 재사용) */
export function closeFind(): void {
  cancelTimer()
  seq++
  lastRun = null
  store().set({ findOpen: false, findHits: [], findIndex: -1, findStatus: 'idle', findCapped: false })
}

/**
 * 찾기 막대가 열린 채 문서가 바뀌면(탭 전환·쪽 편집·EPUB 글자 크기) 결과 쪽 번호가 어긋나므로
 * 자동 재검색한다. App이 마운트될 때 설치하고 해제 함수를 돌려준다.
 */
export function installFindAutoRerun(): () => void {
  return useStore.subscribe((s, prev) => {
    if (!s.findOpen) return
    if (s.activeDocId === prev.activeDocId && s.info === prev.info) return
    cancelTimer()
    if (!s.info) {
      closeFind()
      return
    }
    // 진행 중 검색은 즉시 무효화하고 옛 결과(어긋난 쪽 번호)는 바로 지운다 — 재검색까지 잘못된 강조 방지
    seq++
    const pending = !!store().findQuery.trim()
    store().set({ findHits: [], findIndex: -1, findStatus: pending ? 'searching' : 'idle', findCapped: false })
    timer = setTimeout(() => void runFind(store().findQuery, false), RERUN_DEBOUNCE)
  })
}
