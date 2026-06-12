/** mupdf로 PDF의 각 페이지에서 래스터 이미지를 추출 (HWPX/Markdown 임베드용) */
import * as mupdf from 'mupdf'

export interface PageImage {
  page: number // 1-based (kordoc pageNumber와 일치)
  png: Uint8Array
  /** 표시 폭/높이 (PDF 포인트) — 종횡비 보존용 */
  ptWidth: number
  ptHeight: number
}

/** 너무 작은 장식 이미지·아이콘은 건너뛰기 위한 최소 픽셀 면적 */
const MIN_AREA = 64 * 64

/** 각 페이지를 통째로 래스터화 — 레이아웃 보존 HWPX용 (페이지=전면 이미지) */
export function renderPageImages(buffer: ArrayBuffer, dpi = 144): PageImage[] {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument
  const out: PageImage[] = []
  const scale = dpi / 72
  const n = doc.countPages()
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i)
    const [x0, y0, x1, y1] = page.getBounds()
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
    const png = pix.asPNG()
    out.push({
      page: i + 1,
      png: new Uint8Array(png.slice(0)),
      ptWidth: x1 - x0,
      ptHeight: y1 - y0
    })
    pix.destroy?.()
  }
  doc.destroy?.()
  return out
}

export function extractPageImages(buffer: ArrayBuffer): PageImage[] {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf') as mupdf.PDFDocument
  const out: PageImage[] = []
  const pageCount = doc.countPages()

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i)
    const st = page.toStructuredText('preserve-images')
    st.walk({
      onImageBlock(bbox: mupdf.Rect, _matrix: mupdf.Matrix, image: mupdf.Image) {
        try {
          const [bx0, by0, bx1, by1] = bbox as unknown as [number, number, number, number]
          const bw = bx1 - bx0
          const bh = by1 - by0
          const pix = image.toPixmap()
          const w = pix.getWidth()
          const h = pix.getHeight()
          if (w * h < MIN_AREA) {
            pix.destroy?.()
            return
          }
          const png = pix.asPNG()
          out.push({
            page: i + 1,
            png: new Uint8Array(png.slice(0)),
            ptWidth: bw > 1 ? bw : w,
            ptHeight: bh > 1 ? bh : h
          })
          pix.destroy?.()
        } catch {
          /* 개별 이미지 추출 실패는 무시 */
        }
      }
    })
  }
  doc.destroy?.()
  return out
}
