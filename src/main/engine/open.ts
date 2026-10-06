/** 문서 열기 — 확장자로 PDF/EPUB을 가르고, EPUB은 고정 쪽 크기로 리플로우한다. */
import * as mupdf from 'mupdf'
import { EPUB_FONT, EPUB_PAGE, clampEpubFontSize, docKindOf, type DocKind } from '../../shared/doc-kind'

export interface EngineDoc {
  doc: mupdf.Document
  /** 편집 가능한 PDF 핸들 — EPUB(읽기 전용)이면 null */
  pdf: mupdf.PDFDocument | null
  kind: DocKind
  /** EPUB 본문 글자 크기(pt), PDF는 null */
  fontSize: number | null
}

export function openEngineDoc(path: string, bytes: Uint8Array): EngineDoc {
  const kind = docKindOf(path)
  if (kind === 'epub') {
    const doc = mupdf.Document.openDocument(bytes, 'application/epub+zip')
    relayoutEpub(doc, EPUB_FONT.default)
    return { doc, pdf: null, kind, fontSize: EPUB_FONT.default }
  }
  const pdf = mupdf.Document.openDocument(bytes, 'application/pdf') as mupdf.PDFDocument
  pdf.enableJournal() // Ctrl+Z/Ctrl+Shift+Z 되돌리기/다시하기
  return { doc: pdf, pdf, kind, fontSize: null }
}

/** EPUB을 주어진 글자 크기로 다시 쪽 나눔 — 적용된(범위 보정된) 크기를 돌려준다 */
export function relayoutEpub(doc: mupdf.Document, size: number): number {
  const em = clampEpubFontSize(size)
  doc.layout(EPUB_PAGE.width, EPUB_PAGE.height, em)
  return em
}
