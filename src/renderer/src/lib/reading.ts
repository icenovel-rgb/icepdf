/**
 * 읽기 기능 — 읽던 곳 기억, EPUB 읽기 테마, 밑줄(형광펜) 추가·삭제·모아보기, 문장 카드 열기.
 * 기록은 메인의 library.json(IPC)에, PDF 형광펜은 문서 주석에 저장된다.
 * 비동기 결과는 시작한 문서(docId)에만 반영한다(updateDoc) — 그 사이 탭이 바뀌어도 안전.
 */
import { useStore, type DocSlice } from '../state/store'
import { clearDocImages } from './images'
import { docBaseName, mapPageAfterRelayout } from '../../../shared/doc-kind'
import {
  hexToRgb,
  notesToMarkdown,
  resumeTarget,
  sortNotes,
  type EpubNote,
  type EpubTheme,
  type NoteItem,
  type NoteMark,
  type NoteStyle
} from '../../../shared/reading'
import type { DocInfo, RelaidDoc, ResolvedNoteInfo } from '../../../shared/types'

const api = (): typeof window.icepdf => window.icepdf
const store = (): ReturnType<typeof useStore.getState> => useStore.getState()
const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** 쪽 이동이 멎은 뒤 이만큼 지나면 읽던 곳 기록 */
const POSITION_DELAY = 700
const HIGHLIGHT_OPACITY = 0.45

// ── 시작 ──

let started: Promise<void> | null = null

/** 앱 시작 시 한 번 — 저장된 테마 적용 + 읽던 곳 추적. 문서 열기는 이걸 기다린다 */
export function initReading(): Promise<void> {
  if (!started) started = start()
  return started
}

async function start(): Promise<void> {
  installPositionTracker()
  try {
    const settings = await api().libraryGetSettings()
    if (settings.epubTheme !== 'light') {
      await api().engine(store().activeDocId, 'setTheme', { theme: settings.epubTheme })
    }
    store().set({ epubTheme: settings.epubTheme })
    await restoreEpubFont(settings.epubFont)
  } catch (err) {
    console.error('읽기 설정 불러오기 실패:', err)
  }
}

/** 저장된 읽기 글꼴 — 문서를 열기 전에 걸어 둔다(글꼴이 쪽 나눔을 바꾸므로). 지워진 글꼴이면 이번엔 기본으로 */
async function restoreEpubFont(epubFont: string): Promise<void> {
  if (!epubFont) return
  try {
    await api().setEpubFont(epubFont)
    store().set({ epubFont })
  } catch (err) {
    // 설정은 지우지 않는다 — 글꼴을 다시 설치하면 다음 실행부터 돌아온다
    console.error('읽기 글꼴 복원 실패 — 책 기본 글꼴로 엽니다:', err)
  }
}

// ── 읽던 곳 ──

const pendingPositions = new Map<string, Record<string, unknown>>()
let positionTimer: ReturnType<typeof setTimeout> | null = null

function flushPositions(): void {
  if (positionTimer) clearTimeout(positionTimer)
  positionTimer = null
  for (const [key, patch] of pendingPositions) void api().libraryPatchBook(key, patch)
  pendingPositions.clear()
}

function rememberPosition(info: DocInfo, page: number): void {
  if (!info.key) return
  pendingPositions.set(info.key, {
    title: info.title,
    path: info.filePath,
    kind: info.kind,
    lastPage: page,
    pageCount: info.pageCount,
    fontSize: info.fontSize
  })
  if (positionTimer) clearTimeout(positionTimer)
  positionTimer = setTimeout(flushPositions, POSITION_DELAY)
}

function installPositionTracker(): void {
  useStore.subscribe((s, prev) => {
    if (!s.info || (s.currentPage === prev.currentPage && s.info === prev.info)) return
    rememberPosition(s.info, s.currentPage)
  })
  window.addEventListener('beforeunload', flushPositions)
}

/** 탭을 닫기 직전 — 그 문서의 마지막 위치를 바로 기록 */
export function rememberNow(): void {
  const s = store()
  if (s.info) rememberPosition(s.info, s.currentPage)
  flushPositions()
}

/**
 * 막 연 문서를 읽던 곳으로 — EPUB은 저장된 글자 크기로 다시 배치한 뒤 쪽을 계산한다.
 * 탭을 열기 전에 호출 (처음부터 그 쪽으로 열려 깜빡임이 없다).
 */
export async function restoreReading(docId: number, info: DocInfo): Promise<{ info: DocInfo; page: number }> {
  try {
    const rec = await api().libraryGetBook(info.key)
    if (!rec) return { info, page: 0 }
    let next = info
    if (info.kind === 'epub' && rec.fontSize && rec.fontSize !== info.fontSize) {
      next = await api().engine(docId, 'setFontSize', { size: rec.fontSize })
    }
    return { info: next, page: resumeTarget(rec, next.pageCount) }
  } catch (err) {
    console.error('읽던 곳 불러오기 실패:', err)
    return { info, page: 0 }
  }
}

// ── 읽기 테마 ──

/** EPUB 테마 변경 — mupdf CSS가 전역이라 열린 EPUB 탭 전체를 다시 그린다 */
export async function setEpubTheme(theme: EpubTheme): Promise<void> {
  const s = store()
  if (s.epubTheme === theme) return
  s.set({ epubTheme: theme })
  try {
    await api().engine(s.activeDocId, 'setTheme', { theme })
    repaintEpubTabs()
    void api().libraryPatchSettings({ epubTheme: theme })
  } catch (err) {
    s.showToast(`테마 변경 실패: ${errMsg(err)}`)
  }
}

// ── 읽기 글꼴 ──

let fontsLoading: Promise<void> | null = null

/** 설치된 한글 글꼴 목록 (툴바 글꼴 칸) — 한 번만 불러온다 */
export function loadReadingFonts(): Promise<void> {
  if (!fontsLoading) {
    fontsLoading = api()
      .listReadingFonts()
      .then((readingFonts) => store().set({ readingFonts }))
      .catch((err) => {
        fontsLoading = null
        store().set({ readingFonts: [] })
        console.error('글꼴 목록 실패:', err)
      })
  }
  return fontsLoading
}

let fontChanging = false
/** 바꾸는 도중 또 고른 글꼴 — 끝나면 마지막 것만 적용한다 */
let queuedFont: string | null = null

/**
 * EPUB 본문 글꼴 변경 — mupdf 글꼴·CSS가 전역이라 열린 EPUB 탭이 모두 다시 나뉜다.
 * 탭마다 쪽 위치를 비율로 옮기고 밑줄 위치를 다시 찾는다.
 */
export async function setEpubFont(id: string): Promise<void> {
  if (fontChanging) {
    queuedFont = id
    return
  }
  const s = store()
  if (s.epubFont === id) return
  fontChanging = true
  const prev = s.epubFont
  s.set({ epubFont: id })
  const busyTimer = setTimeout(() => store().set({ busy: '글꼴에 맞춰 쪽을 다시 나누는 중...' }), 250)
  try {
    const relaid = await api().setEpubFont(id)
    for (const doc of relaid) applyRelayout(doc)
    void api().libraryPatchSettings({ epubFont: id })
  } catch (err) {
    store().set({ epubFont: prev })
    s.showToast(`글꼴 변경 실패: ${errMsg(err)}`)
    await resyncEpubTabs() // 엔진이 어디까지 바뀌었든 화면을 엔진 상태에 맞춘다
  } finally {
    fontChanging = false
    clearTimeout(busyTimer)
    store().set({ busy: null })
  }
  const next = queuedFont
  queuedFont = null
  if (next !== null && next !== store().epubFont) await setEpubFont(next)
}

/** 열린 EPUB 탭마다 엔진의 현재 정보로 다시 맞춘다 (글꼴 변경 실패 뒤) */
async function resyncEpubTabs(): Promise<void> {
  const s = store()
  const epubIds = s.tabs
    .filter((t) => (t.id === s.activeTabId ? s.info?.kind : t.snapshot.info?.kind) === 'epub')
    .map((t) => t.docId)
  for (const docId of epubIds) {
    try {
      applyRelayout({ docId, info: await api().engine(docId, 'docInfo', {}) })
    } catch (err) {
      console.error('EPUB 탭 다시 맞추기 실패:', err)
    }
  }
}

function applyRelayout({ docId, info }: RelaidDoc): void {
  if (!store().tabs.some((t) => t.docId === docId)) return
  clearDocImages(docId)
  let page = 0
  store().updateDoc(docId, (slice) => {
    const oldCount = slice.info?.pageCount ?? info.pageCount
    page = mapPageAfterRelayout(slice.currentPage, oldCount, info.pageCount)
    return { info, epoch: slice.epoch + 1, selection: null, currentPage: page }
  })
  // 비활성 탭은 돌아올 때 switchTab이 currentPage로 스크롤한다
  if (store().activeDocId === docId) store().gotoPage(page)
  void resolveEpubNotes(docId)
}

function repaintEpubTabs(): void {
  const s = store()
  for (const t of s.tabs) {
    const kind = t.id === s.activeTabId ? s.info?.kind : t.snapshot.info?.kind
    if (kind !== 'epub') continue
    clearDocImages(t.docId)
    store().updateDoc(t.docId, (slice) => ({ epoch: slice.epoch + 1 }))
  }
}

// ── 밑줄 ──

/** EPUB 밑줄 기록 + 해석 결과 → 모아보기 목록·쪽 표시 */
function epubView(notes: EpubNote[], resolved: ResolvedNoteInfo[]): Pick<DocSlice, 'notes' | 'noteMarks'> {
  const byId = new Map(resolved.map((r) => [r.id, r.marks]))
  const noteMarks: Record<number, NoteMark[]> = {}
  const items: NoteItem[] = notes.map((n) => {
    const marks = byId.get(n.id) ?? []
    for (const m of marks) {
      ;(noteMarks[m.page] ??= []).push({ id: n.id, color: n.color, style: n.style, rects: m.rects })
    }
    const first = marks[0]
    return {
      id: n.id,
      source: 'epub',
      page: first ? first.page : -1,
      y: first?.rects[0]?.[1] ?? 0,
      text: n.text,
      color: n.color,
      style: n.style,
      createdAt: n.createdAt
    }
  })
  return { notes: sortNotes(items), noteMarks }
}

/**
 * 문서별 요청 번호 — 겹친 비동기 결과 중 마지막 요청 것만 반영한다
 * (예: 밑줄을 연달아 추가하면 먼저 끝난 옛 목록이 새 목록을 덮지 않게).
 */
const latestSeq = new Map<string, number>()
function nextSeq(kind: string, docId: number): () => boolean {
  const key = `${kind}:${docId}`
  const seq = (latestSeq.get(key) ?? 0) + 1
  latestSeq.set(key, seq)
  return () => latestSeq.get(key) === seq
}

/** EPUB 밑줄을 현재 레이아웃에서 다시 찾는다 (열기·글자 크기 변경·추가·삭제 후) */
export async function resolveEpubNotes(docId: number, notes?: EpubNote[]): Promise<void> {
  const tab = store().tabs.find((t) => t.docId === docId)
  if (!tab) return
  const list = notes ?? (store().activeDocId === docId ? store().epubNotes : tab.snapshot.epubNotes)
  const isLatest = nextSeq('resolve', docId)
  // 기록은 바로 반영 (위치 해석을 기다리는 동안 삭제·추가가 옛 목록을 보지 않게)
  store().updateDoc(docId, () => ({ epubNotes: list }))
  if (!list.length) {
    store().updateDoc(docId, () => ({ notes: [], noteMarks: {} }))
    return
  }
  try {
    const resolved = await api().engine(docId, 'resolveNotes', {
      notes: list.map((n) => ({ id: n.id, anchor: n.anchor }))
    })
    if (isLatest()) store().updateDoc(docId, () => epubView(list, resolved))
  } catch (err) {
    console.error('밑줄 위치 찾기 실패:', err)
  }
}

/** PDF 형광펜 주석 → 모아보기 목록 */
export async function refreshPdfNotes(docId: number): Promise<void> {
  const isLatest = nextSeq('pdf', docId)
  try {
    const list = await api().engine(docId, 'listHighlights', {})
    const items: NoteItem[] = list.map((h) => ({ ...h, source: 'pdf' }))
    if (isLatest()) store().updateDoc(docId, () => ({ notes: sortNotes(items) }))
  } catch (err) {
    console.error('형광펜 목록 실패:', err)
  }
}

/** 문서를 연 직후 — EPUB은 서재 기록의 밑줄을 불러와 위치를 찾는다 */
export async function loadNotes(docId: number, info: DocInfo): Promise<void> {
  if (info.kind === 'pdf') return refreshPdfNotes(docId)
  try {
    const rec = await api().libraryGetBook(info.key)
    await resolveEpubNotes(docId, rec?.notes ?? [])
  } catch (err) {
    console.error('밑줄 불러오기 실패:', err)
  }
}

/**
 * PDF 주석 편집 결과를 **그 문서에만** 반영 — 기다리는 동안 탭을 바꿔도
 * 다른 탭에 이 문서의 정보(경로·키)가 들어가 엉뚱한 파일에 저장되는 일이 없게.
 */
async function applyPdfEdit(docId: number): Promise<void> {
  const info = await api().engine(docId, 'docInfo', {})
  const undo = await api().engine(docId, 'undoState', {})
  store().updateDoc(docId, (slice) => ({
    info,
    dirty: true,
    epoch: slice.epoch + 1,
    currentPage: Math.min(slice.currentPage, info.pageCount - 1),
    selection: null,
    selectedImage: null,
    canUndo: undo.canUndo,
    canRedo: undo.canRedo
  }))
  await refreshPdfNotes(docId)
}

const newId = (): string => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 현재 선택을 밑줄로 — EPUB은 서재 기록, PDF는 형광펜 주석(원문 포함) */
export async function addNoteFromSelection(color: string, style: NoteStyle): Promise<void> {
  const s = store()
  const sel = s.selection
  const info = s.info
  if (!sel || !sel.quads.length || !info) return
  const docId = s.activeDocId
  try {
    if (info.kind === 'pdf') {
      await api().engine(docId, 'addHighlight', {
        page: sel.page,
        quads: sel.quads,
        color: hexToRgb(color),
        opacity: HIGHLIGHT_OPACITY,
        style,
        text: sel.text.trim()
      })
      await applyPdfEdit(docId)
      return
    }
    const anchor = await api().engine(docId, 'noteAnchor', { page: sel.page, quads: sel.quads })
    if (!anchor) {
      s.showToast('선택한 곳에서 글자를 찾지 못했습니다')
      return
    }
    const note: EpubNote = { id: newId(), color, style, text: sel.text.trim(), anchor, createdAt: Date.now() }
    store().updateDoc(docId, () => ({ selection: null }))
    // 저장된 기록 위에서 합친다 — 같은 책을 연 다른 탭의 밑줄을 지우지 않는다
    const notes = await api().libraryAddNote(info.key, note)
    await resolveEpubNotes(docId, notes ?? [])
  } catch (err) {
    s.showToast(`밑줄 실패: ${errMsg(err)}`)
  }
}

export async function deleteNote(id: string): Promise<void> {
  const s = store()
  const info = s.info
  if (!info) return
  const docId = s.activeDocId
  try {
    if (info.kind === 'pdf') {
      await api().engine(docId, 'deleteHighlight', { id })
      await applyPdfEdit(docId)
      return
    }
    const notes = await api().libraryRemoveNote(info.key, id)
    await resolveEpubNotes(docId, notes ?? [])
  } catch (err) {
    s.showToast(`밑줄 삭제 실패: ${errMsg(err)}`)
  }
}

/** EPUB 지우개 — 클릭한 곳의 밑줄 삭제 */
export async function eraseNoteAt(page: number, x: number, y: number): Promise<boolean> {
  const marks = store().noteMarks[page] ?? []
  const hit = [...marks].reverse().find((m) => m.rects.some((r) => x >= r[0] && x <= r[2] && y >= r[1] - 2 && y <= r[3] + 2))
  if (!hit) return false
  await deleteNote(hit.id)
  return true
}

export function gotoNote(note: NoteItem): void {
  if (note.page < 0) {
    store().showToast('이 밑줄의 위치를 찾지 못했습니다 — 책 내용이 바뀌었을 수 있습니다')
    return
  }
  store().gotoPageAt(note.page, Math.max(0, note.y - 40))
}

function bookTitle(): string {
  return docBaseName(store().info?.title ?? '문서')
}

export async function copyAllNotes(): Promise<void> {
  const notes = store().notes
  if (!notes.length) return
  await navigator.clipboard.writeText(notesToMarkdown(bookTitle(), notes))
  store().showToast(`밑줄 ${notes.length}개를 복사했습니다`)
}

export async function exportNotesMarkdown(): Promise<void> {
  const s = store()
  if (!s.notes.length) return
  const title = bookTitle()
  try {
    const path = await api().saveTextFile(
      { title: '밑줄 내보내기', defaultPath: `${title} 밑줄.md`, ext: 'md', extName: 'Markdown' },
      notesToMarkdown(title, s.notes)
    )
    if (path) s.showToast(`밑줄을 저장했습니다: ${path}`)
  } catch (err) {
    s.showToast(`밑줄 저장 실패: ${errMsg(err)}`)
  }
}

// ── 문장 카드 ──

export function openCard(text: string): void {
  const t = text.trim()
  if (!t) return
  store().set({ cardDraft: { text: t, source: bookTitle() } })
}

