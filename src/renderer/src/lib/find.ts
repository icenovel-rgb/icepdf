/** 찾기(Ctrl+F) 순수 로직 — 결과 탐색·순환·페이지별 분류·상태 문구. 스토어/엔진 의존 없음. */
import type { Quad, SearchHit } from '../../../shared/types'

/** 한 번에 모을 최대 결과 수 — 넘으면 "N+"로 표시 */
export const FIND_MAX_HITS = 5000
/** 엔진에 한 번에 맡길 쪽 수 — 작을수록 검색 도중 렌더 요청이 끼어들 틈이 많다 */
export const FIND_CHUNK_PAGES = 12
/** 선택 영역을 검색어로 미리 채울 최대 길이 */
const PREFILL_MAX = 64

export type FindStatus = 'idle' | 'searching' | 'done'

/** 현재 쪽 이후 첫 결과 — 없으면 처음으로 순환. 결과가 없으면 -1 */
export function firstHitFrom(hits: SearchHit[], page: number): number {
  if (!hits.length) return -1
  const i = hits.findIndex((h) => h.page >= page)
  return i >= 0 ? i : 0
}

/** 현재 쪽 이하 마지막 결과 — 없으면 끝으로 순환 (이전 방향 시작점). 결과가 없으면 -1 */
export function lastHitUpTo(hits: SearchHit[], page: number): number {
  if (!hits.length) return -1
  for (let i = hits.length - 1; i >= 0; i--) {
    if (hits[i].page <= page) return i
  }
  return hits.length - 1
}

/** 다음/이전 결과 (양 끝에서 순환) */
export function stepHit(index: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1
  return (((index + dir) % total) + total) % total
}

/** 한 쪽에 속한 결과만 — 전역 인덱스를 함께 돌려줘 "현재 결과" 강조에 쓴다 */
export function hitsForPage(hits: SearchHit[], page: number): { index: number; quads: Quad[] }[] {
  const out: { index: number; quads: Quad[] }[] = []
  hits.forEach((h, index) => {
    if (h.page === page) out.push({ index, quads: h.quads })
  })
  return out
}

/** 결과의 최상단 y (pt) — 결과로 스크롤할 때 기준 */
export function hitTop(hit: SearchHit): number {
  let top = Number.POSITIVE_INFINITY
  for (const q of hit.quads) top = Math.min(top, q[1], q[3], q[5], q[7])
  return Number.isFinite(top) ? top : 0
}

export function findStatusText(st: {
  query: string
  status: FindStatus
  index: number
  total: number
  capped: boolean
}): string {
  if (!st.query.trim() || st.status === 'idle') return ''
  const total = `${st.total}${st.capped ? '+' : ''}`
  if (st.status === 'searching') {
    return st.index >= 0 ? `${st.index + 1} / ${total}…` : `검색 중… ${total}`
  }
  if (st.total === 0) return '결과 없음'
  return `${st.index >= 0 ? st.index + 1 : 0} / ${total}`
}

/** Ctrl+F 시 선택한 텍스트를 검색어로 — 한 줄짜리 짧은 선택만 */
export function queryFromSelection(text: string | undefined): string {
  const t = (text ?? '').trim()
  if (!t || /[\r\n]/.test(t) || t.length > PREFILL_MAX) return ''
  return t
}
