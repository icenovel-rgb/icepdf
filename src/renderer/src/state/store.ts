import { create } from 'zustand'
import type { DocInfo, Quad, Rect } from '../../../shared/types'

export type Tool = 'select' | 'highlight' | 'eraser' | 'image' | 'text'
export type ViewMode = 'scroll' | 'grid' | 'slide'
export type SidebarTab = 'thumbnails' | 'bookmarks'

export interface Selection {
  page: number
  quads: Quad[]
  text: string
}

export interface OcrWord {
  x: number
  y: number
  w: number
  h: number
  text: string
}

export interface PendingImage {
  path: string
  data: ArrayBuffer
  naturalW: number
  naturalH: number
}

/** 삽입된 이미지(Stamp 주석)의 편집 상태 — 자유 회전/반전/리사이즈 (#9, #C) */
export interface SelectedImage {
  page: number
  index: number
  /** 원본 PNG (회전/반전/스트레치 재변환용) */
  origData: ArrayBuffer
  naturalW: number
  naturalH: number
  /** 중심 좌표 (fitz pt) */
  cx: number
  cy: number
  /** 회전 전 표시 크기 (pt) */
  w0: number
  h0: number
  /** 자유 회전 각도 (도) */
  rotation: number
  flipH: boolean
  flipV: boolean
  /** 파생된 축정렬 바운딩박스 (엔진/오버레이용) */
  rect: Rect
  /** 텍스트 주석이면 원본 텍스트/스타일(재편집·비례 크기조절용). 일반 삽입 이미지면 undefined */
  text?: { content: string; font: string; size: number; color: string }
}

/** 문서(탭)마다 독립적으로 보존되는 상태 슬라이스 */
export interface DocSlice {
  info: DocInfo | null
  dirty: boolean
  currentPage: number
  zoom: number
  fitWidthTick: number
  fitPageTick: number
  viewMode: ViewMode
  spread: 1 | 2
  cover: boolean
  tool: Tool
  pendingImage: PendingImage | null
  selection: Selection | null
  selectedImage: SelectedImage | null
  ocrLayers: Record<number, OcrWord[]>
  epoch: number
  scrollTarget: number | null
  navSeq: number
  /** 되돌리기/다시하기 가능 여부 (문서별) */
  canUndo: boolean
  canRedo: boolean
}

/** 윈도우 탐색기 스타일 탭 — 각자 독립 문서(docId)와 슬라이스 보유 */
export interface Tab {
  id: number
  docId: number
  /** 비활성 시 보존되는 상태 (활성 탭은 라이브 스토어가 진실) */
  snapshot: DocSlice
}

const SLICE_KEYS = [
  'info', 'dirty', 'currentPage', 'zoom', 'fitWidthTick', 'fitPageTick', 'viewMode',
  'spread', 'cover', 'tool', 'pendingImage', 'selection', 'selectedImage', 'ocrLayers',
  'epoch', 'scrollTarget', 'navSeq', 'canUndo', 'canRedo'
] as const

const EMPTY_SLICE: DocSlice = {
  info: null,
  dirty: false,
  currentPage: 0,
  zoom: 1,
  fitWidthTick: 0,
  fitPageTick: 0,
  viewMode: 'scroll',
  spread: 1,
  cover: true,
  tool: 'select',
  pendingImage: null,
  selection: null,
  selectedImage: null,
  ocrLayers: {},
  epoch: 0,
  scrollTarget: null,
  navSeq: 0,
  canUndo: false,
  canRedo: false
}

let nextTabId = 1

interface AppState extends DocSlice {
  // ── 탭(윈도우 단위, 문서 무관) ──
  tabs: Tab[]
  activeTabId: number | null
  /** 활성 탭의 엔진 문서 id — 모든 engine 호출이 이걸로 라우팅 */
  activeDocId: number

  // ── 윈도우 전역 상태 (탭 전환에도 유지) ──
  sidebar: SidebarTab | null
  sidebarWidth: number
  highlightColor: string
  /** 텍스트 툴 스타일 (탭 전환에도 유지) */
  textFont: string
  textSize: number
  textColor: string
  /** 스페이스바 손도구 패닝 모드 (#D) */
  panMode: boolean
  /** 크롬(툴바/사이드바/상태바) 숨김 — Tab */
  chromeHidden: boolean
  /** 창 전체화면 — Ctrl+L (크롬 숨김 동반) */
  fullscreen: boolean
  /** 후원 모달 표시 */
  showSupport: boolean
  busy: string | null
  toast: string | null

  set: (partial: Partial<AppState>) => void
  applyEdit: (info: DocInfo) => void
  gotoPage: (page: number) => void
  showToast: (message: string) => void
  /** 새 문서를 탭으로 열고 활성화 */
  openTab: (docId: number, info: DocInfo) => void
  /** 탭 전환 (현재 슬라이스 보존 후 대상 복원) */
  switchTab: (tabId: number) => void
  /** 탭 제거 (엔진 문서 해제는 호출부 책임) — 활성 탭이면 이웃으로 전환 */
  removeTab: (tabId: number) => void
}

/** 현재 라이브 스토어에서 문서 슬라이스만 추출 */
function sliceOf(s: AppState): DocSlice {
  const out: Record<string, unknown> = {}
  for (const k of SLICE_KEYS) out[k] = s[k]
  return out as unknown as DocSlice
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<AppState>((set, get) => ({
  info: null,
  dirty: false,
  currentPage: 0,
  zoom: 1,
  fitWidthTick: 0,
  fitPageTick: 0,
  viewMode: 'scroll',
  spread: 1,
  cover: true,
  tabs: [],
  activeTabId: null,
  activeDocId: 0,
  sidebar: 'thumbnails',
  sidebarWidth: 210,
  tool: 'select',
  highlightColor: '#ffe04d',
  textFont: 'Malgun Gothic',
  textSize: 18,
  textColor: '#d11a1a',
  pendingImage: null,
  selection: null,
  selectedImage: null,
  panMode: false,
  chromeHidden: false,
  fullscreen: false,
  ocrLayers: {},
  showSupport: false,
  epoch: 0,
  busy: null,
  toast: null,
  scrollTarget: null,
  navSeq: 0,
  canUndo: false,
  canRedo: false,

  set: (partial) => set(partial),

  applyEdit: (info) =>
    set({
      info,
      dirty: true,
      epoch: get().epoch + 1,
      currentPage: Math.min(get().currentPage, info.pageCount - 1),
      selection: null,
      selectedImage: null
    }),

  gotoPage: (page) => {
    const info = get().info
    if (!info) return
    const p = Math.max(0, Math.min(info.pageCount - 1, page))
    set({ scrollTarget: p, currentPage: p, navSeq: get().navSeq + 1 })
  },

  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => set({ toast: null }), 4000)
  },

  openTab: (docId, info) => {
    const s = get()
    const saved =
      s.activeTabId != null
        ? s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, snapshot: sliceOf(s) } : t))
        : s.tabs
    const id = nextTabId++
    const slice: DocSlice = { ...EMPTY_SLICE, info, scrollTarget: 0 }
    set({
      tabs: [...saved, { id, docId, snapshot: slice }],
      activeTabId: id,
      activeDocId: docId,
      ...slice
    })
  },

  switchTab: (tabId) => {
    const s = get()
    if (tabId === s.activeTabId) return
    const target = s.tabs.find((t) => t.id === tabId)
    if (!target) return
    const saved =
      s.activeTabId != null
        ? s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, snapshot: sliceOf(s) } : t))
        : s.tabs
    set({
      tabs: saved,
      activeTabId: tabId,
      activeDocId: target.docId,
      ...target.snapshot,
      scrollTarget: target.snapshot.currentPage,
      navSeq: target.snapshot.navSeq + 1
    })
  },

  removeTab: (tabId) => {
    const s = get()
    const idx = s.tabs.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const remaining = s.tabs.filter((t) => t.id !== tabId)
    // 비활성 탭 닫기 — 활성 상태 그대로
    if (s.activeTabId !== tabId) {
      set({ tabs: remaining })
      return
    }
    // 마지막 탭 닫기 → 시작 화면
    if (remaining.length === 0) {
      set({ tabs: [], activeTabId: null, activeDocId: 0, ...EMPTY_SLICE })
      return
    }
    // 활성 탭 닫기 → 이웃 탭 활성화
    const next = remaining[Math.min(idx, remaining.length - 1)]
    set({
      tabs: remaining,
      activeTabId: next.id,
      activeDocId: next.docId,
      ...next.snapshot,
      scrollTarget: next.snapshot.currentPage,
      navSeq: next.snapshot.navSeq + 1
    })
  }
}))
