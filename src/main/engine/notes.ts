/**
 * 밑줄(형광펜) 엔진 측 — EPUB은 텍스트 앵커 생성·해석, PDF는 그룹 단위 형광펜 주석.
 * PDF 형광펜은 quad마다 테두리 없는 Square(각진 형광펜)로 그리고, 같은 그룹 id와
 * 칠한 원문을 주석 사전에 넣어 모아보기·그룹 삭제가 가능하게 한다.
 */
import * as mupdf from 'mupdf'
import {
  buildAnchor,
  charsInQuads,
  compactChars,
  rectsForRange,
  resolveAnchor,
  type PageChar,
  type TextAnchor
} from '../../shared/anchor'
import { colorToHex, type NoteStyle } from '../../shared/reading'
import type { Quad, Rect } from '../../shared/types'

export interface PageText {
  chars: PageChar[]
  text: string
  map: number[]
}

/** 쪽 글자 + 공백 제거 문자열 (재배치·편집 전까지 캐시) */
export function pageText(st: mupdf.StructuredText): PageText {
  const chars: PageChar[] = []
  let line = -1
  st.walk({
    beginLine() {
      line++
    },
    onChar(c, _origin, _font, _size, quad) {
      chars.push({ c, quad: Array.from(quad as unknown as number[]), line: Math.max(0, line) })
    }
  })
  const { text, map } = compactChars(chars)
  return { chars, text, map }
}

/** 공백 뺀 쪽 문자열 (범위 밖 '') — 전 쪽 탐색용, 가볍다 */
export type TextOf = (page: number) => string
/** 쪽 글자 좌표 (범위 밖 null) — 표시할 쪽에서만 */
export type CharsOf = (page: number) => PageText | null

/** 선택 쿼드 → 앵커 (선택이 글자를 못 덮으면 null) */
export function anchorForQuads(
  textOf: TextOf,
  charsOf: CharsOf,
  page: number,
  pageCount: number,
  quads: Quad[]
): TextAnchor | null {
  const cur = charsOf(page)
  if (!cur) return null
  const range = charsInQuads(cur.chars, quads)
  if (!range) return null
  const start = cur.map.indexOf(range[0])
  const end = cur.map.indexOf(range[1]) + 1
  if (start < 0 || end <= start) return null
  return buildAnchor(
    { prev: textOf(page - 1), cur: cur.text, next: textOf(page + 1) },
    start,
    end,
    pageCount > 0 ? page / pageCount : 0
  )
}

export interface ResolvedNote {
  id: string
  /** 쪽별 사각형 — 못 찾았으면 빈 배열 */
  marks: { page: number; rects: Rect[] }[]
}

export function resolveNotes(
  textOf: TextOf,
  charsOf: CharsOf,
  pageCount: number,
  anchors: { id: string; anchor: TextAnchor }[]
): ResolvedNote[] {
  // 1) 위치는 가벼운 문자열로만 찾고
  const found = anchors.map(({ id, anchor }) => ({ id, segments: resolveAnchor(anchor, pageCount, textOf)?.segments ?? [] }))
  // 2) 글자 좌표는 쪽 순서대로 한 번씩 — 밑줄이 여러 쪽에 흩어져도 좌표 캐시가 계속 뒤바뀌지 않게
  const rectsByKey = new Map<string, Rect[]>()
  const segs = found.flatMap((f, i) => f.segments.map((seg, j) => ({ seg, key: `${i}:${j}` })))
  segs.sort((a, b) => a.seg.page - b.seg.page)
  for (const { seg, key } of segs) {
    const pt = charsOf(seg.page)
    rectsByKey.set(key, pt ? rectsForRange(pt.chars, pt.map, seg.start, seg.end) : [])
  }
  return found.map((f, i) => ({
    id: f.id,
    marks: f.segments.map((seg, j) => ({ page: seg.page, rects: rectsByKey.get(`${i}:${j}`) ?? [] }))
  }))
}

// ── PDF 형광펜 그룹 ──

const KEY_GROUP = 'ICEPDFHighlight'
const KEY_STYLE = 'ICEPDFHighlightStyle'
/** 밑줄 두께 = 줄 높이 비율 */
const UNDERLINE_RATIO = 0.12

export interface PdfHighlight {
  id: string
  page: number
  y: number
  text: string
  color: string
  style: NoteStyle
  createdAt: number
}

function quadBounds(q: Quad): Rect {
  return [Math.min(q[0], q[4]), Math.min(q[1], q[3]), Math.max(q[2], q[6]), Math.max(q[5], q[7])]
}

/** quad마다 각진 Square를 그리고 그룹 id·원문·스타일을 주석 사전에 남긴다 */
export function addPdfHighlight(
  pdf: mupdf.PDFDocument,
  page: number,
  args: { quads: Quad[]; color: [number, number, number]; opacity: number; style: NoteStyle; text: string; id: string }
): void {
  const p = pdf.loadPage(page)
  for (const q of args.quads) {
    const [x0, y0, x1, y1] = quadBounds(q)
    const rect: Rect =
      args.style === 'underline' ? [x0, y1 - Math.max(1, (y1 - y0) * UNDERLINE_RATIO), x1, y1] : [x0, y0, x1, y1]
    const annot = p.createAnnotation('Square')
    annot.setRect(rect)
    annot.setColor([]) // 테두리 없음
    annot.setInteriorColor(args.color)
    annot.setBorderWidth(0)
    annot.setOpacity(args.style === 'underline' ? 0.9 : args.opacity)
    if (args.text) annot.setContents(args.text)
    const obj = annot.getObject()
    obj.put(KEY_GROUP, pdf.newString(args.id))
    obj.put(KEY_STYLE, pdf.newName(args.style))
    annot.update()
  }
}

/** 형광펜 Square의 원문·그룹·스타일 — z-순서 변경(삭제 후 재생성) 때 옮겨 담는 용도 */
export interface HighlightMeta {
  contents: string
  group: string | null
  style: string | null
}

export function readHighlightMeta(annot: mupdf.PDFAnnotation): HighlightMeta {
  const style = annot.getObject().get(KEY_STYLE)
  return { contents: annot.getContents(), group: groupOf(annot), style: style.isName() ? style.asName() : null }
}

export function writeHighlightMeta(pdf: mupdf.PDFDocument, annot: mupdf.PDFAnnotation, meta: HighlightMeta): void {
  if (meta.contents) annot.setContents(meta.contents)
  if (meta.group) annot.getObject().put(KEY_GROUP, pdf.newString(meta.group))
  if (meta.style) annot.getObject().put(KEY_STYLE, pdf.newName(meta.style))
}

function groupOf(annot: mupdf.PDFAnnotation): string | null {
  const v = annot.getObject().get(KEY_GROUP)
  return v && v.isString() ? v.asString() : null
}

function hasAnnots(pdf: mupdf.PDFDocument, page: number): boolean {
  const annots = pdf.findPage(page).get('Annots')
  return annots.isArray() && annots.length > 0
}

/** 문서 전체의 형광펜 그룹 (원문이 있는 것만 — 예전 버전 형광펜은 원문이 없어 제외) */
export function listPdfHighlights(pdf: mupdf.PDFDocument): PdfHighlight[] {
  const out: PdfHighlight[] = []
  const n = pdf.countPages()
  for (let page = 0; page < n; page++) {
    // 쪽 사전만 보고 주석이 없으면 건너뛴다 — 큰 PDF에서 모든 쪽을 로드하지 않게
    if (!hasAnnots(pdf, page)) continue
    const p = pdf.loadPage(page)
    const seen = new Set<string>()
    for (const a of p.getAnnotations()) {
      if (a.getType() !== 'Square') continue
      const id = groupOf(a)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const text = a.getContents()
      if (!text) continue
      const style = readHighlightMeta(a).style === 'underline' ? 'underline' : 'highlight'
      const created = Number(/^hl-(\d+)/.exec(id)?.[1] ?? 0)
      out.push({
        id,
        page,
        y: (a.getBounds() as unknown as Rect)[1],
        text,
        color: colorToHex(a.getInteriorColor() as number[]),
        style,
        createdAt: created
      })
    }
  }
  return out
}

/** 그룹 id의 Square 전부 삭제 — 지운 개수 */
export function deletePdfHighlight(pdf: mupdf.PDFDocument, id: string): number {
  let removed = 0
  const n = pdf.countPages()
  for (let page = 0; page < n; page++) {
    // 쪽 사전만 보고 주석이 없으면 건너뛴다 — 큰 PDF에서 모든 쪽을 로드하지 않게
    if (!hasAnnots(pdf, page)) continue
    const p = pdf.loadPage(page)
    for (const a of p.getAnnotations().slice()) {
      if (a.getType() === 'Square' && groupOf(a) === id) {
        p.deleteAnnotation(a)
        removed++
      }
    }
  }
  return removed
}
