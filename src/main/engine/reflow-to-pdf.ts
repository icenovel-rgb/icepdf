/**
 * 리플로우 문서(EPUB) → PDF 변환. 현재 레이아웃(글자 크기·쪽 나눔) 그대로 굽는다.
 *
 * 1) DocumentWriter로 각 쪽을 그린다 — 텍스트는 글꼴째 들어가 검색·복사·kordoc 추출이 된다.
 * 2) DocumentWriter는 링크·목차를 옮기지 않으므로 원본에서 읽어 다시 붙인다.
 * 3) 폰트 서브셋 — 안 하면 mupdf 내장 CJK 대체 폰트가 통째로 들어가 수 MB가 된다(6쪽 1.8MB→46KB).
 */
import * as mupdf from 'mupdf'
import type { Rect } from '../../shared/types'
import { pageDestUri, readOutline, writeOutline } from './outline'

interface LinkPlan {
  page: number
  rect: Rect
  uri: string
  external: boolean
  target: number
}

function collectLinks(src: mupdf.Document, page: mupdf.Page, index: number): LinkPlan[] {
  return page.getLinks().map((l) => {
    const external = l.isExternal()
    let target = -1
    if (!external) {
      try {
        target = src.resolveLink(l)
      } catch {
        target = -1
      }
    }
    return { page: index, rect: l.getBounds() as unknown as Rect, uri: l.getURI(), external, target }
  })
}

export function reflowableToPdf(src: mupdf.Document, title?: string): Uint8Array {
  const n = src.countPages()
  const buf = new mupdf.Buffer()
  const writer = new mupdf.DocumentWriter(buf, 'pdf', '')
  const links: LinkPlan[] = []
  try {
    for (let i = 0; i < n; i++) {
      const page = src.loadPage(i)
      try {
        const dev = writer.beginPage(page.getBounds())
        page.run(dev, mupdf.Matrix.identity)
        writer.endPage()
        links.push(...collectLinks(src, page, i))
      } finally {
        page.destroy()
      }
    }
  } finally {
    writer.close()
  }

  // asUint8Array() 뷰를 넘기면 안 된다 — openDocument가 내부에서 Malloc(이때 wasm 메모리가
  // 커질 수 있음)한 뒤 뷰를 복사하므로, 메모리가 커지면 뷰가 detach되어 큰 EPUB에서 실패한다.
  const out = mupdf.Document.openDocument(buf, 'application/pdf') as mupdf.PDFDocument
  try {
    for (const l of links) {
      if (!l.external && l.target < 0) continue // 해석 못 한 내부 링크는 버림
      const uri = l.external ? l.uri : pageDestUri(out, l.target)
      out.loadPage(l.page).createLink(l.rect, uri)
    }
    writeOutline(out, readOutline(src))
    if (title) out.setMetaData('info:Title', title)
    out.subsetFonts()
    const saved = out.saveToBuffer('garbage=compact,compress')
    try {
      // wasm 메모리 위의 뷰이므로 다른 할당이 일어나기 전에 즉시 복사
      return Uint8Array.from(saved.asUint8Array())
    } finally {
      saved.destroy()
    }
  } finally {
    out.destroy()
    buf.destroy()
  }
}
