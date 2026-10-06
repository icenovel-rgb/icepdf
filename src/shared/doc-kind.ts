/**
 * 문서 종류(PDF/EPUB) 공용 규칙 — 메인·워커·렌더러가 함께 쓴다.
 * EPUB은 mupdf가 리플로우(글자 크기에 따라 쪽을 다시 나눔)하는 읽기 전용 문서다.
 */

export type DocKind = 'pdf' | 'epub'

/** EPUB 레이아웃 페이지 크기 (pt) — 배율 100%에서 문고본 한 쪽 정도 */
export const EPUB_PAGE = { width: 480, height: 680 } as const

/** EPUB 본문 글자 크기 (pt) */
export const EPUB_FONT = { default: 14, min: 8, max: 36, step: 2 } as const

export function docKindOf(path: string): DocKind {
  return /\.epub$/i.test(path) ? 'epub' : 'pdf'
}

/** 열기·드래그드롭·연결 프로그램으로 받아들이는 파일 */
export function isOpenableDocPath(path: string): boolean {
  return /\.(pdf|epub)$/i.test(path)
}

/** 편집(주석·쪽 편집·저장)이 불가능한 종류 */
export function isReadOnlyKind(kind: DocKind | undefined): boolean {
  return kind === 'epub'
}

/** 탭 제목에서 확장자를 뗀 이름 — 내보내기 기본 파일명용 */
export function docBaseName(title: string): string {
  const base = title.replace(/\.(pdf|epub)$/i, '')
  return base || '문서'
}

export function clampEpubFontSize(size: number): number {
  if (!Number.isFinite(size)) return EPUB_FONT.default
  return Math.max(EPUB_FONT.min, Math.min(EPUB_FONT.max, Math.round(size)))
}

/**
 * 글자 크기를 바꿔 쪽 수가 달라졌을 때 읽던 위치를 비율로 옮긴다.
 * (mupdf.js는 위치 북마크 API를 노출하지 않아 쪽 시작 지점의 비율로 근사)
 */
export function mapPageAfterRelayout(page: number, oldCount: number, newCount: number): number {
  if (oldCount <= 1 || newCount <= 1) return 0
  const mapped = Math.floor((page * newCount) / oldCount + 1e-9)
  return Math.max(0, Math.min(newCount - 1, mapped))
}
