/** 책갈피(목차) 읽기/쓰기 — PDF와 EPUB(리플로우) 모두 같은 BookmarkItem 트리로 다룬다. */
import type * as mupdf from 'mupdf'
import type { BookmarkItem } from '../../shared/types'

interface MupdfOutlineNode {
  title?: string
  uri?: string
  page?: number
  down?: MupdfOutlineNode[]
}

/** 목적지 쪽을 해석한다 — EPUB 목차는 page 없이 'OEBPS/ch2.xhtml#id' 같은 uri만 준다. */
function resolvePage(doc: mupdf.Document, it: MupdfOutlineNode): number {
  if (typeof it.page === 'number' && it.page >= 0) return it.page
  if (!it.uri) return 0
  try {
    return Math.max(0, doc.resolveLink(it.uri))
  } catch {
    return 0
  }
}

export function readOutline(doc: mupdf.Document): BookmarkItem[] {
  const walk = (items: MupdfOutlineNode[] | undefined): BookmarkItem[] =>
    (items ?? []).map((it) => ({
      title: it.title ?? '(제목 없음)',
      page: resolvePage(doc, it),
      children: walk(it.down)
    }))
  return walk((doc.loadOutline() as MupdfOutlineNode[] | null) ?? undefined)
}

/** 쪽 맨 위로 이동하는 PDF 내부 목적지 URI (배율은 유지 → /XYZ 0 top null) */
export function pageDestUri(doc: mupdf.PDFDocument, page: number): string {
  return doc.formatLinkURI({
    type: 'XYZ',
    chapter: 0,
    page: Math.max(0, Math.min(page, doc.countPages() - 1)),
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    zoom: 0
  })
}

/** PDF의 책갈피를 통째로 교체한다 (저널이 켜져 있으면 호출부가 operation 안에서 불러야 함) */
export function writeOutline(doc: mupdf.PDFDocument, items: BookmarkItem[]): void {
  const it = doc.outlineIterator()
  while (it.item()) it.delete()
  const insertLevel = (nodes: BookmarkItem[]): void => {
    for (const node of nodes) {
      it.insert({ title: node.title, open: false, uri: pageDestUri(doc, node.page) })
      if (node.children.length) {
        it.prev()
        it.down()
        insertLevel(node.children)
        it.up()
        it.next()
      }
    }
  }
  insertLevel(items)
}
