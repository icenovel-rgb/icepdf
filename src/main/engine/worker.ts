/**
 * mupdf 문서 엔진 — worker_thread에서 실행.
 * 탭별 문서(PDF/EPUB)를 소유하고 RPC 메시지로 조작한다. 모든 좌표는 fitz 공간.
 * EPUB은 리플로우 읽기 전용 — 편집 연산은 requireDoc()에서 막힌다.
 */
import { parentPort } from 'node:worker_threads'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import * as mupdf from 'mupdf'
import type { BookmarkItem, DocInfo, LinkInfo, Quad, Rect } from '../../shared/types'
import { EPUB_PAGE } from '../../shared/doc-kind'
import { openEngineDoc, relayoutEpub, type EngineDoc } from './open'
import { readOutline, writeOutline } from './outline'
import { searchPages } from './search'
import { reflowableToPdf } from './reflow-to-pdf'
import {
  addPdfHighlight,
  anchorForQuads,
  deletePdfHighlight,
  listPdfHighlights,
  pageText,
  readHighlightMeta,
  resolveNotes,
  writeHighlightMeta,
  type HighlightMeta,
  type PageText
} from './notes'
import { EPUB_THEMES, isEpubTheme, pdfDocKey, type NoteStyle } from '../../shared/reading'
import type { TextAnchor } from '../../shared/anchor'

interface DocState extends EngineDoc {
  path: string | null
  /** 읽기 기록 키 — EPUB은 내용 해시(옮겨도 유지), PDF는 경로 */
  key: string
  /** 페이지 구조 변경 시 비워야 하는 캐시 */
  stCache: Map<number, mupdf.StructuredText>
  /** 밑줄 찾기용 쪽 글자(공백 제거 문자열) — 전 쪽을 훑어도 가볍게 문자열만 (재배치·편집 시 비움) */
  textCache: Map<number, string>
  /** 밑줄 표시용 쪽 글자 좌표 — 무거워서 최근 쪽 몇 개만 (재배치·편집 시 비움) */
  charsCache: Map<number, PageText>
  /** EPUB 원본 바이트 — 테마를 바꾸면 이걸로 다시 연다 (PDF는 null) */
  bytes: Uint8Array | null
  /** 인쇄용 원래 색 사본 (다크·세피아로 읽는 중 인쇄할 때만 만든다) */
  plain: { doc: mupdf.Document; fontSize: number | null } | null
}

/** 글자 좌표를 들고 있을 쪽 수 */
const CHARS_CACHE_PAGES = 16

/**
 * 현재 EPUB 읽기 테마 CSS (mupdf 전역 setUserCSS).
 * mupdf는 각 장(chapter)을 **처음 그릴 때의** CSS로 해석해 문서에 붙잡아 두고,
 * 이미 그린 장은 다시 배치해도(캐시를 비워도) 새 CSS를 반영하지 않는다(스파이크 확인).
 * 그래서 테마를 바꾸면 EPUB을 원본 바이트에서 새로 연다. 전역 CSS는 평소 항상 themeCss.
 */
let themeCss = ''

function openEpub(bytes: Uint8Array, fontSize: number): mupdf.Document {
  const doc = mupdf.Document.openDocument(bytes, 'application/epub+zip')
  relayoutEpub(doc, fontSize)
  return doc
}

/** 탭별로 열린 문서들 — docId(메인 프로세스 할당)로 키. */
const docs = new Map<number, DocState>()

/** z-순서 변경 시 Stamp를 다시 그릴 해상도 배율(포인트당 px) — 높을수록 선명, 메모리↑ */
const REORDER_SCALE = 4

function requireState(docId: number): DocState {
  const st = docs.get(docId)
  if (!st) throw new Error('열린 문서가 없습니다')
  return st
}

/** 읽기 연산용 — PDF·EPUB 공통 */
function requireAny(docId: number): mupdf.Document {
  return requireState(docId).doc
}

/** 편집 연산용 — EPUB(읽기 전용)이면 거부 */
function requireDoc(docId: number): mupdf.PDFDocument {
  const st = requireState(docId)
  if (!st.pdf) throw new Error('EPUB은 읽기 전용입니다 — PDF로 변환한 뒤 편집하세요')
  return st.pdf
}

function writeAtomic(path: string, bytes: Uint8Array): void {
  const tmp = join(dirname(path), `.${basename(path)}.icepdf-tmp`)
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
}

/** EPUB을 현재 레이아웃 그대로 PDF 바이트로 (변환 저장·Markdown/한글/이미지 내보내기 공용) */
function epubToPdfBytes(st: DocState): Uint8Array {
  const title = st.doc.getMetaData('info:Title') || (st.path ? basename(st.path).replace(/\.epub$/i, '') : '')
  if (!themeCss || !st.bytes) return reflowableToPdf(st.doc, title)
  // 다크·세피아 배경이 PDF에 구워지지 않게 원래 색으로 연 사본을 같은 글자 크기로 변환한다.
  // 장은 그릴 때 CSS를 읽으므로 변환이 끝날 때까지 전역 CSS를 비워 둔다(워커는 단일 스레드).
  mupdf.setUserCSS('')
  const plain = openEpub(st.bytes, st.fontSize as number)
  try {
    return reflowableToPdf(plain, title)
  } finally {
    plain.destroy?.()
    mupdf.setUserCSS(themeCss)
  }
}

function invalidate(target: number | DocState): void {
  const st = typeof target === 'number' ? docs.get(target) : target
  st?.stCache.clear()
  st?.textCache.clear()
  st?.charsCache.clear()
}

/** 쪽 글자를 뽑고 Page·StructuredText는 바로 해제 (전 쪽을 훑어도 wasm 힙이 쌓이지 않게) */
function walkPage(st: DocState, page: number): PageText {
  const p = st.doc.loadPage(page)
  const stext = p.toStructuredText('preserve-whitespace')
  try {
    const pt = pageText(stext)
    st.textCache.set(page, pt.text)
    return pt
  } finally {
    stext.destroy?.()
    p.destroy?.()
  }
}

/** 밑줄 찾기용 — 공백 뺀 쪽 문자열 (범위 밖이면 '') */
function textOf(st: DocState, page: number): string {
  if (page < 0 || page >= st.doc.countPages()) return ''
  return st.textCache.get(page) ?? walkPage(st, page).text
}

/** 밑줄 표시용 — 글자 좌표 (범위 밖이면 null). 최근 CHARS_CACHE_PAGES쪽만 보관 */
function charsOf(st: DocState, page: number): PageText | null {
  if (page < 0 || page >= st.doc.countPages()) return null
  const hit = st.charsCache.get(page)
  if (hit) {
    st.charsCache.delete(page) // 최근 사용으로 갱신
    st.charsCache.set(page, hit)
    return hit
  }
  const pt = walkPage(st, page)
  st.charsCache.set(page, pt)
  if (st.charsCache.size > CHARS_CACHE_PAGES) st.charsCache.delete(st.charsCache.keys().next().value as number)
  return pt
}

function dropPlain(st: DocState): void {
  st.plain?.doc.destroy?.()
  st.plain = null
}

/** 쪽 하나를 PNG로 */
function renderPage(doc: mupdf.Document, page: number, scale: number) {
  const p = doc.loadPage(page)
  const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  const png = pix.asPNG()
  const result = { png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), width: pix.getWidth(), height: pix.getHeight() }
  pix.destroy()
  p.destroy?.()
  return result
}

/**
 * 원래 색으로 렌더 (EPUB 다크·세피아로 읽는 중 인쇄할 때). 사본은 장을 그릴 때 CSS를 읽으므로
 * 렌더하는 동안 전역 CSS를 비운다(워커는 단일 스레드라 다른 연산과 섞이지 않는다).
 */
function renderPlain(st: DocState, page: number, scale: number) {
  mupdf.setUserCSS('')
  try {
    if (!st.plain || st.plain.fontSize !== st.fontSize) {
      dropPlain(st)
      st.plain = { doc: openEpub(st.bytes as Uint8Array, st.fontSize as number), fontSize: st.fontSize }
    }
    return renderPage(st.plain.doc, page, scale)
  } finally {
    mupdf.setUserCSS(themeCss)
  }
}

function docKeyFor(path: string, kind: string, bytes: Uint8Array): string {
  return kind === 'epub' ? 'epub:' + createHash('sha1').update(bytes).digest('hex') : pdfDocKey(path)
}

/**
 * 변경 작업을 저널 트랜잭션으로 감싼다 — Ctrl+Z 한 번에 통째로 되돌려진다.
 * (형광펜 여러 quad, 이미지 삽입+변형 등은 한 단위로 묶임)
 */
function mutate<T>(docId: number, name: string, fn: () => T): T {
  const doc = requireDoc(docId)
  doc.beginOperation(name)
  try {
    const result = fn()
    doc.endOperation()
    return result
  } catch (err) {
    doc.abandonOperation()
    throw err
  }
}

function undoState(docId: number): { canUndo: boolean; canRedo: boolean } {
  const pdf = requireState(docId).pdf
  if (!pdf) return { canUndo: false, canRedo: false }
  return { canUndo: pdf.canUndo(), canRedo: pdf.canRedo() }
}

function getStructuredText(docId: number, page: number): mupdf.StructuredText {
  const st = requireState(docId)
  const cached = st.stCache.get(page)
  if (cached) return cached
  const text = st.doc.loadPage(page).toStructuredText('preserve-whitespace')
  st.stCache.set(page, text)
  return text
}

function docInfo(docId: number): DocInfo {
  const st = requireState(docId)
  const doc = st.doc
  const pageCount = doc.countPages()
  const pages = []
  if (st.kind === 'epub') {
    // 리플로우 문서는 모든 쪽이 레이아웃 크기 — 쪽마다 loadPage 하지 않는다(큰 책에서 느림)
    for (let i = 0; i < pageCount; i++) pages.push({ width: EPUB_PAGE.width, height: EPUB_PAGE.height })
  } else {
    for (let i = 0; i < pageCount; i++) {
      const [x0, y0, x1, y1] = doc.loadPage(i).getBounds()
      pages.push({ width: x1 - x0, height: y1 - y0 })
    }
  }
  return {
    filePath: st.path,
    pageCount,
    pages,
    outline: readOutline(doc),
    title: st.path ? basename(st.path) : '제목 없음',
    kind: st.kind,
    fontSize: st.fontSize,
    key: st.key
  }
}

// ── RPC 연산 ──

const ops: Record<string, (docId: number, args: any) => unknown> = {
  open(docId, { path }: { path: string }) {
    const prev = docs.get(docId)
    if (prev) dropPlain(prev)
    prev?.doc.destroy?.()
    const bytes = readFileSync(path)
    const opened = openEngineDoc(path, bytes)
    const key = docKeyFor(path, opened.kind, bytes)
    const epubBytes = opened.kind === 'epub' ? bytes : null
    docs.set(docId, {
      ...opened,
      path,
      key,
      stCache: new Map(),
      textCache: new Map(),
      charsCache: new Map(),
      bytes: epubBytes,
      plain: null
    })
    return docInfo(docId)
  },

  /** EPUB 읽기 테마 — mupdf 전역 CSS를 바꾸고 열린 EPUB을 모두 다시 배치(색만 바뀌어 쪽 수는 그대로) */
  setTheme(_docId, { theme }: { theme: string }) {
    if (!isEpubTheme(theme)) throw new Error('알 수 없는 테마입니다')
    themeCss = EPUB_THEMES[theme].css
    mupdf.setUserCSS(themeCss)
    for (const st of docs.values()) {
      if (st.kind !== 'epub' || !st.bytes) continue
      const old = st.doc
      st.doc = openEpub(st.bytes, st.fontSize as number)
      old.destroy?.()
      invalidate(st)
    }
    return null
  },

  /** 선택 영역 → 밑줄 앵커 (EPUB) */
  noteAnchor(docId, { page, quads }: { page: number; quads: Quad[] }) {
    const st = requireState(docId)
    return anchorForQuads((p) => textOf(st, p), (p) => charsOf(st, p), page, st.doc.countPages(), quads)
  },

  /** 저장된 앵커들을 현재 레이아웃에서 찾아 쪽별 사각형으로 (EPUB) */
  resolveNotes(docId, { notes }: { notes: { id: string; anchor: TextAnchor }[] }) {
    const st = requireState(docId)
    return resolveNotes((p) => textOf(st, p), (p) => charsOf(st, p), st.doc.countPages(), notes)
  },

  /** PDF 형광펜 그룹 목록 (모아보기) — EPUB은 빈 목록 */
  listHighlights(docId) {
    const pdf = requireState(docId).pdf
    return pdf ? listPdfHighlights(pdf) : []
  },

  deleteHighlight(docId, { id }: { id: string }) {
    return mutate(docId, 'delete-highlight', () => ({ removed: deletePdfHighlight(requireDoc(docId), id) }))
  },

  docInfo(docId) {
    return docInfo(docId)
  },

  setFontSize(docId, { size }: { size: number }) {
    const st = requireState(docId)
    if (st.kind !== 'epub') throw new Error('글자 크기는 EPUB에서만 바꿀 수 있습니다')
    st.fontSize = relayoutEpub(st.doc, size)
    invalidate(docId)
    return docInfo(docId)
  },

  exportPdf(docId, { path }: { path: string }) {
    const st = requireState(docId)
    if (st.kind !== 'epub') throw new Error('PDF 변환은 EPUB 문서에서만 사용할 수 있습니다')
    writeAtomic(path, epubToPdfBytes(st))
    return { path, pageCount: st.doc.countPages() }
  },

  render(docId, { page, scale, plain }: { page: number; scale: number; plain?: boolean }) {
    const st = requireState(docId)
    // plain = 인쇄 — 다크·세피아 테마여도 종이에는 원래 색으로
    if (plain && st.kind === 'epub' && themeCss && st.bytes) return renderPlain(st, page, scale)
    return renderPage(st.doc, page, scale)
  },

  selection(docId, { page, ax, ay, bx, by }: { page: number; ax: number; ay: number; bx: number; by: number }) {
    const st = getStructuredText(docId, page)
    const quads = st.highlight([ax, ay], [bx, by], 1000) as unknown as Quad[]
    const text = st.copy([ax, ay], [bx, by])
    return { quads, text }
  },

  search(docId, { needle, from, to, maxHits }: { needle: string; from: number; to: number; maxHits: number }) {
    return searchPages(requireAny(docId), needle, from, to, maxHits)
  },

  addHighlight(
    docId,
    args: { page: number; quads: Quad[]; color: [number, number, number]; opacity: number; style?: NoteStyle; text?: string; id?: string }
  ) {
    return mutate(docId, 'highlight', () => {
      // mupdf Highlight 주석은 끝이 둥글다 → quad별 테두리 없는 Square로 각진 형광펜 구현
      const pdf = requireDoc(docId)
      const id = args.id ?? `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      addPdfHighlight(pdf, args.page, {
        quads: args.quads,
        color: args.color,
        opacity: args.opacity,
        style: args.style ?? 'highlight',
        text: args.text ?? '',
        id
      })
      return { count: pdf.loadPage(args.page).getAnnotations().length, id }
    })
  },

  addImage(docId, { page, rect, png }: { page: number; rect: Rect; png: ArrayBuffer }) {
    return mutate(docId, 'insert', () => {
      const p = requireDoc(docId).loadPage(page)
      const annot = p.createAnnotation('Stamp')
      annot.setRect(rect)
      annot.setStampImage(new mupdf.Image(new Uint8Array(png)))
      annot.update()
      const annots = p.getAnnotations()
      return { index: annots.length - 1, count: annots.length }
    })
  },

  updateStamp(docId, { page, index, rect, png }: { page: number; index: number; rect: Rect; png: ArrayBuffer }) {
    return mutate(docId, 'edit', () => {
      const p = requireDoc(docId).loadPage(page)
      const annot = p.getAnnotations()[index]
      if (!annot) throw new Error('해당 이미지 주석이 없습니다')
      annot.setStampImage(new mupdf.Image(new Uint8Array(png)))
      annot.setRect(rect)
      annot.update()
      return { count: p.getAnnotations().length }
    })
  },

  setAnnotRect(docId, { page, index, rect }: { page: number; index: number; rect: Rect }) {
    return mutate(docId, 'move', () => {
      const p = requireDoc(docId).loadPage(page)
      const annot = p.getAnnotations()[index]
      if (!annot) throw new Error('해당 주석이 없습니다')
      annot.setRect(rect)
      annot.update()
      return { count: p.getAnnotations().length }
    })
  },

  listAnnots(docId, { page }: { page: number }) {
    const pdf = requireState(docId).pdf
    if (!pdf) return [] // EPUB에는 주석이 없다
    const p = pdf.loadPage(page)
    return p.getAnnotations().map((a, index) => ({
      index,
      type: a.getType(),
      rect: a.getBounds() as unknown as Rect
    }))
  },

  getLinks(docId, { page }: { page: number }): LinkInfo[] {
    const doc = requireAny(docId)
    const p = doc.loadPage(page)
    return p.getLinks().map((l) => {
      const uri = l.getURI()
      const external = l.isExternal()
      const [x0, y0, x1, y1] = l.getBounds() as unknown as Rect
      // 내부 링크만 페이지로 해석 (외부 URL은 resolveLink가 -1)
      let target = -1
      if (!external) {
        try {
          const r = doc.resolveLink(uri)
          target = typeof r === 'number' && r >= 0 ? r : -1
        } catch {
          target = -1
        }
      }
      return { rect: [x0, y0, x1, y1] as Rect, uri, external, page: target }
    })
  },

  hitAnnot(docId, { page, x, y, types }: { page: number; x: number; y: number; types?: string[] }) {
    const pdf = requireState(docId).pdf
    if (!pdf) return null // EPUB 클릭은 개체 선택 없음
    const p = pdf.loadPage(page)
    const annots = p.getAnnotations()
    // 위에 그려진 주석이 우선 — 역순 탐색
    for (let i = annots.length - 1; i >= 0; i--) {
      const a = annots[i]
      const type = a.getType()
      if (types && !types.includes(type)) continue
      const [x0, y0, x1, y1] = a.getBounds() as unknown as Rect
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        return { index: i, type, rect: [x0, y0, x1, y1] as Rect }
      }
    }
    return null
  },

  deleteAnnot(docId, { page, index }: { page: number; index: number }) {
    return mutate(docId, 'delete', () => {
      const p = requireDoc(docId).loadPage(page)
      const annots = p.getAnnotations()
      if (!annots[index]) throw new Error('해당 주석이 없습니다')
      p.deleteAnnotation(annots[index])
      return { count: p.getAnnotations().length }
    })
  },

  insertBlank(docId, { at }: { at: number }) {
    return mutate(docId, 'insert-page', () => {
      const doc = requireDoc(docId)
      const ref = Math.max(0, Math.min(at, doc.countPages() - 1))
      const [x0, y0, x1, y1] = doc.loadPage(ref).getBounds()
      const blank = doc.addPage([0, 0, x1 - x0, y1 - y0], 0, doc.addObject({}), '')
      doc.insertPage(at, blank)
      invalidate(docId)
      return docInfo(docId)
    })
  },

  insertFromPdf(docId, { at, path }: { at: number; path: string }) {
    return mutate(docId, 'insert-pdf', () => {
      const doc = requireDoc(docId)
      const src = mupdf.Document.openDocument(readFileSync(path), 'application/pdf') as mupdf.PDFDocument
      const n = src.countPages()
      for (let i = 0; i < n; i++) {
        doc.graftPage(at + i, src, i)
      }
      src.destroy?.()
      invalidate(docId)
      return docInfo(docId)
    })
  },

  deletePage(docId, { page }: { page: number }) {
    return mutate(docId, 'delete-page', () => {
      const doc = requireDoc(docId)
      if (doc.countPages() <= 1) throw new Error('마지막 페이지는 삭제할 수 없습니다')
      doc.deletePage(page)
      invalidate(docId)
      return docInfo(docId)
    })
  },

  setOutline(docId, { items }: { items: BookmarkItem[] }) {
    return mutate(docId, 'bookmark', () => {
      writeOutline(requireDoc(docId), items)
      return docInfo(docId)
    })
  },

  reorderAnnot(docId, { page, index, where }: { page: number; index: number; where: 'front' | 'back' }) {
    return mutate(docId, where === 'front' ? 'to-front' : 'to-back', () => {
      const p = requireDoc(docId).loadPage(page)
      const annots = p.getAnnotations()
      if (!annots[index]) throw new Error('해당 주석이 없습니다')
      // 모든 주석을 복원 레시피로 스냅샷 — Square는 속성으로 정확 복원, 그 외(Stamp 등)는
      // 현재 모습을 고해상도로 래스터화해 Stamp로 재생성(mupdf는 주석 페인트 순서를 못 바꿈).
      type Recipe =
        | { kind: 'square'; rect: Rect; interior: number[]; opacity: number; border: number; meta: HighlightMeta }
        | { kind: 'stamp'; rect: Rect; png: Uint8Array }
      const recipes: Recipe[] = annots.map((a) => {
        const rect = a.getBounds() as unknown as Rect
        if (a.getType() === 'Square') {
          // 형광펜 원문·그룹·스타일도 옮겨야 모아보기에서 사라지지 않는다
          return {
            kind: 'square',
            rect,
            interior: a.getInteriorColor() as number[],
            opacity: a.getOpacity(),
            border: a.getBorderWidth(),
            meta: readHighlightMeta(a)
          }
        }
        const pix = a.toPixmap(mupdf.Matrix.scale(REORDER_SCALE, REORDER_SCALE), mupdf.ColorSpace.DeviceRGB, true)
        const png = pix.asPNG()
        pix.destroy?.()
        return { kind: 'stamp', rect, png: new Uint8Array(png) }
      })
      const moved = recipes[index]
      const rest = recipes.filter((_, i) => i !== index)
      // front = 마지막에 그림(맨 위), back = 처음에 그림(맨 아래)
      const order = where === 'front' ? [...rest, moved] : [moved, ...rest]
      for (const a of annots.slice()) p.deleteAnnotation(a)
      for (const r of order) {
        if (r.kind === 'square') {
          const a = p.createAnnotation('Square')
          a.setRect(r.rect)
          a.setColor([])
          a.setInteriorColor(r.interior as [number, number, number])
          a.setBorderWidth(r.border)
          a.setOpacity(r.opacity)
          writeHighlightMeta(requireDoc(docId), a, r.meta)
          a.update()
        } else {
          const a = p.createAnnotation('Stamp')
          a.setRect(r.rect)
          a.setStampImage(new mupdf.Image(r.png))
          a.update()
        }
      }
      return { info: docInfo(docId), index: where === 'front' ? order.length - 1 : 0 }
    })
  },

  undo(docId) {
    const pdf = requireState(docId).pdf
    if (pdf?.canUndo()) pdf.undo()
    invalidate(docId)
    return { info: docInfo(docId), ...undoState(docId) }
  },

  redo(docId) {
    const pdf = requireState(docId).pdf
    if (pdf?.canRedo()) pdf.redo()
    invalidate(docId)
    return { info: docInfo(docId), ...undoState(docId) }
  },

  undoState(docId) {
    return undoState(docId)
  },

  save(docId, { path }: { path: string }) {
    const st = requireState(docId)
    writeAtomic(path, requireDoc(docId).saveToBuffer('garbage=compact').asUint8Array())
    st.path = path
    st.key = pdfDocKey(path)
    return { path, key: st.key }
  },

  /** 변환(kordoc)·이미지 내보내기용 PDF 바이트 — EPUB은 현재 레이아웃을 PDF로 구워서 준다 */
  getPdfBuffer(docId) {
    const st = requireState(docId)
    const bytes = st.pdf ? st.pdf.saveToBuffer('garbage=compact').asUint8Array() : epubToPdfBytes(st)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  },

  close(docId) {
    const st = docs.get(docId)
    if (st) dropPlain(st)
    st?.doc.destroy?.()
    docs.delete(docId)
    return null
  }
}

interface RpcRequest {
  id: number
  docId: number
  op: string
  args: Record<string, unknown>
}

parentPort?.on('message', (msg: RpcRequest) => {
  try {
    const fn = ops[msg.op]
    if (!fn) throw new Error(`알 수 없는 연산: ${msg.op}`)
    const result = fn(msg.docId, msg.args ?? {})
    const transfer: ArrayBuffer[] = []
    if (result && typeof result === 'object') {
      const png = (result as { png?: ArrayBuffer }).png
      if (png instanceof ArrayBuffer) transfer.push(png)
      if (result instanceof ArrayBuffer) transfer.push(result)
    }
    parentPort?.postMessage({ id: msg.id, ok: true, result }, transfer)
  } catch (err) {
    parentPort?.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})
