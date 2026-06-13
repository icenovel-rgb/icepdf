/** 렌더러·메인·워커가 공유하는 타입. 좌표는 전부 fitz 공간(좌상단 원점, y 아래, 72dpi 포인트). */

export interface PageInfo {
  width: number
  height: number
}

export interface BookmarkItem {
  title: string
  page: number
  children: BookmarkItem[]
}

export interface DocInfo {
  filePath: string | null
  pageCount: number
  pages: PageInfo[]
  outline: BookmarkItem[]
  title: string
}

/** 사각형 [x0, y0, x1, y1] */
export type Rect = [number, number, number, number]

/** mupdf quad: [ulx, uly, urx, ury, llx, lly, lrx, lry] */
export type Quad = number[]

export interface SelectionResult {
  quads: Quad[]
  text: string
}

export interface RenderResult {
  /** PNG 바이너리 */
  png: ArrayBuffer
  width: number
  height: number
}

export interface AnnotSummary {
  index: number
  type: string
  rect: Rect
}

export interface ConvertResult {
  ok: boolean
  /** 저장된 파일 경로 */
  outPath?: string
  /** 함께 저장된 이미지 수 (markdown 변환 시) */
  imageCount?: number
  warnings?: string[]
  error?: string
}

/** 엔진 워커 RPC 연산 이름 → 인자/반환 타입 매핑 */
export interface EngineOps {
  open: { args: { path: string }; result: DocInfo }
  docInfo: { args: Record<string, never>; result: DocInfo }
  render: { args: { page: number; scale: number }; result: RenderResult }
  selection: {
    args: { page: number; ax: number; ay: number; bx: number; by: number }
    result: SelectionResult
  }
  search: { args: { needle: string; maxHits: number }; result: { page: number; quads: Quad[] }[] }
  addHighlight: {
    args: { page: number; quads: Quad[]; color: [number, number, number]; opacity: number }
    result: { count: number }
  }
  addImage: { args: { page: number; rect: Rect; png: ArrayBuffer }; result: { index: number; count: number } }
  updateStamp: { args: { page: number; index: number; rect: Rect; png: ArrayBuffer }; result: { count: number } }
  setAnnotRect: { args: { page: number; index: number; rect: Rect }; result: { count: number } }
  listAnnots: { args: { page: number }; result: AnnotSummary[] }
  hitAnnot: { args: { page: number; x: number; y: number; types?: string[] }; result: AnnotSummary | null }
  deleteAnnot: { args: { page: number; index: number }; result: { count: number } }
  insertBlank: { args: { at: number }; result: DocInfo }
  insertFromPdf: { args: { at: number; path: string }; result: DocInfo }
  deletePage: { args: { page: number }; result: DocInfo }
  setOutline: { args: { items: BookmarkItem[] }; result: DocInfo }
  save: { args: { path: string }; result: { path: string } }
  getPdfBuffer: { args: Record<string, never>; result: ArrayBuffer }
  close: { args: Record<string, never>; result: null }
}

export type EngineOpName = keyof EngineOps

/** 메인 → 렌더러 메뉴/단축키 액션 */
export type MenuAction =
  | 'open'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'save'
  | 'saveAs'
  | 'exportMarkdown'
  | 'exportHwpx'
  | 'exportImages'
  | 'addBookmark'
  | 'ocr'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitWidth'
  | 'fitPage'
  | 'toggleGrid'
  | 'toggleSlide'
  | 'toggleSidebar'
  | 'toggleFullscreen'
  | 'support'
