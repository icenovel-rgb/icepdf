/** 렌더러·메인·워커가 공유하는 타입. 좌표는 전부 fitz 공간(좌상단 원점, y 아래, 72dpi 포인트). */
import type { DocKind } from './doc-kind'
import type { TextAnchor } from './anchor'
import type { NoteStyle, ReadingFontFile } from './reading'

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
  /** pdf=편집 가능, epub=리플로우 읽기 전용 */
  kind: DocKind
  /** EPUB 본문 글자 크기(pt). PDF는 null */
  fontSize: number | null
  /** 읽기 기록(읽던 곳·밑줄) 키 — EPUB은 내용 해시, PDF는 경로 */
  key: string
}

/** PDF 형광펜 그룹 한 건 (모아보기) */
export interface PdfHighlightInfo {
  id: string
  page: number
  y: number
  text: string
  color: string
  style: NoteStyle
  createdAt: number
}

/** EPUB 앵커 해석 결과 — 못 찾았으면 marks가 빈 배열 */
export interface ResolvedNoteInfo {
  id: string
  marks: { page: number; rects: Rect[] }[]
}

/** 사각형 [x0, y0, x1, y1] */
export type Rect = [number, number, number, number]

/** mupdf quad: [ulx, uly, urx, ury, llx, lly, lrx, lry] */
export type Quad = number[]

/** 찾기 결과 한 건 — 줄을 넘는 결과는 쿼드가 여러 개 */
export interface SearchHit {
  page: number
  quads: Quad[]
}

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

/** PDF 페이지 안의 하이퍼링크 한 개 */
export interface LinkInfo {
  /** 클릭 영역 [x0, y0, x1, y1] (fitz pt) */
  rect: Rect
  /** 원본 URI (외부 링크면 웹/메일 주소, 내부면 mupdf 내부 링크 문자열) */
  uri: string
  /** true=외부(웹/메일/파일) → 기본 브라우저로, false=문서 내 페이지 점프 */
  external: boolean
  /** 내부 링크의 목표 페이지(0-base). 외부이거나 해석 불가면 -1 */
  page: number
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

/** EPUB 읽기 글꼴 — 보통·굵게 면 (굵게가 없으면 보통으로 대신) */
export interface ReadingFontFaces {
  regular: ReadingFontFile
  bold: ReadingFontFile | null
}

/** 글꼴을 바꿔 쪽을 다시 나눈 문서 하나 */
export interface RelaidDoc {
  docId: number
  info: DocInfo
}

/** 엔진 워커 RPC 연산 이름 → 인자/반환 타입 매핑 */
export interface EngineOps {
  open: { args: { path: string }; result: DocInfo }
  docInfo: { args: Record<string, never>; result: DocInfo }
  /** plain = EPUB 읽기 테마와 상관없이 원래 색 (인쇄용) */
  render: { args: { page: number; scale: number; plain?: boolean }; result: RenderResult }
  selection: {
    args: { page: number; ax: number; ay: number; bx: number; by: number }
    result: SelectionResult
  }
  /** [from, to) 쪽 구간만 검색 — 렌더러가 구간을 나눠 호출해 큰 문서에서도 렌더가 멈추지 않게 한다 */
  search: { args: { needle: string; from: number; to: number; maxHits: number }; result: { hits: SearchHit[] } }
  /** EPUB 글자 크기 변경 → 다시 레이아웃 */
  setFontSize: { args: { size: number }; result: DocInfo }
  /** EPUB을 현재 레이아웃 그대로 PDF 파일로 변환 저장 */
  exportPdf: { args: { path: string }; result: { path: string; pageCount: number } }
  addHighlight: {
    args: {
      page: number
      quads: Quad[]
      color: [number, number, number]
      opacity: number
      style?: NoteStyle
      text?: string
      id?: string
    }
    result: { count: number; id: string }
  }
  /** EPUB 읽기 테마 (전역 — 열린 EPUB 전체 재배치) */
  setTheme: { args: { theme: string }; result: null }
  /** EPUB 본문 글꼴 (전역 — 열린 EPUB을 모두 다시 열어 쪽을 다시 나눈다). null = 책 기본 글꼴 */
  setReadingFont: { args: { font: ReadingFontFaces | null }; result: RelaidDoc[] }
  noteAnchor: { args: { page: number; quads: Quad[] }; result: TextAnchor | null }
  resolveNotes: { args: { notes: { id: string; anchor: TextAnchor }[] }; result: ResolvedNoteInfo[] }
  listHighlights: { args: Record<string, never>; result: PdfHighlightInfo[] }
  deleteHighlight: { args: { id: string }; result: { removed: number } }
  addImage: { args: { page: number; rect: Rect; png: ArrayBuffer }; result: { index: number; count: number } }
  updateStamp: { args: { page: number; index: number; rect: Rect; png: ArrayBuffer }; result: { count: number } }
  setAnnotRect: { args: { page: number; index: number; rect: Rect }; result: { count: number } }
  listAnnots: { args: { page: number }; result: AnnotSummary[] }
  getLinks: { args: { page: number }; result: LinkInfo[] }
  hitAnnot: { args: { page: number; x: number; y: number; types?: string[] }; result: AnnotSummary | null }
  deleteAnnot: { args: { page: number; index: number }; result: { count: number } }
  insertBlank: { args: { at: number }; result: DocInfo }
  insertFromPdf: { args: { at: number; path: string }; result: DocInfo }
  deletePage: { args: { page: number }; result: DocInfo }
  setOutline: { args: { items: BookmarkItem[] }; result: DocInfo }
  save: { args: { path: string }; result: { path: string; key: string } }
  getPdfBuffer: { args: Record<string, never>; result: ArrayBuffer }
  reorderAnnot: { args: { page: number; index: number; where: 'front' | 'back' }; result: { info: DocInfo; index: number } }
  undo: { args: Record<string, never>; result: { info: DocInfo; canUndo: boolean; canRedo: boolean } }
  redo: { args: Record<string, never>; result: { info: DocInfo; canUndo: boolean; canRedo: boolean } }
  undoState: { args: Record<string, never>; result: { canUndo: boolean; canRedo: boolean } }
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
  | 'print'
  | 'convertToPdf'
  | 'undo'
  | 'redo'
  | 'find'
  | 'findNext'
  | 'findPrev'
  | 'epubFontUp'
  | 'epubFontDown'
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
  | 'toggleChrome'
  | 'themeLight'
  | 'themeSepia'
  | 'themeDark'
  | 'showNotes'
  | 'support'
  | 'checkUpdate'
