import { create } from 'zustand'
import type { DocInfo, Quad, Rect } from '../../../shared/types'

export type Tool = 'select' | 'highlight' | 'eraser' | 'image'
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
}

interface AppState {
  info: DocInfo | null
  dirty: boolean
  currentPage: number
  zoom: number
  fitWidthTick: number
  fitPageTick: number
  viewMode: ViewMode
  /** 한쪽(1) / 두쪽(2) 보기 */
  spread: 1 | 2
  /** 두쪽 보기에서 첫 페이지를 표지로 단독 배치 */
  cover: boolean
  sidebar: SidebarTab | null
  sidebarWidth: number
  tool: Tool
  highlightColor: string
  pendingImage: PendingImage | null
  selection: Selection | null
  selectedImage: SelectedImage | null
  /** 스페이스바 손도구 패닝 모드 (#D) */
  panMode: boolean
  /** 크롬(툴바/사이드바/상태바) 숨김 — Tab */
  chromeHidden: boolean
  /** 창 전체화면 — Ctrl+L (크롬 숨김 동반) */
  fullscreen: boolean
  /** 페이지별 OCR 텍스트 레이어 (선택 가능 단어, fitz 포인트 좌표) */
  ocrLayers: Record<number, OcrWord[]>
  /** 후원 모달 표시 */
  showSupport: boolean
  epoch: number
  busy: string | null
  toast: string | null
  /** 스크롤 목표 페이지 + 매 요청마다 증가하는 시퀀스 (동일 페이지도 재발화) */
  scrollTarget: number | null
  navSeq: number

  set: (partial: Partial<AppState>) => void
  applyEdit: (info: DocInfo) => void
  gotoPage: (page: number) => void
  showToast: (message: string) => void
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
  sidebar: 'thumbnails',
  sidebarWidth: 210,
  tool: 'select',
  highlightColor: '#ffe04d',
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
  }
}))
