/**
 * mupdf 문서 엔진 — worker_thread에서 실행.
 * 문서 1개를 소유하고 RPC 메시지로 조작한다. 모든 좌표는 fitz 공간.
 */
import { parentPort } from 'node:worker_threads'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import * as mupdf from 'mupdf'
import type { BookmarkItem, DocInfo, LinkInfo, Quad, Rect } from '../../shared/types'

interface DocState {
  doc: mupdf.PDFDocument
  path: string | null
  /** 페이지 구조 변경 시 비워야 하는 캐시 */
  stCache: Map<number, mupdf.StructuredText>
}

/** 탭별로 열린 문서들 — docId(메인 프로세스 할당)로 키. */
const docs = new Map<number, DocState>()

function requireState(docId: number): DocState {
  const st = docs.get(docId)
  if (!st) throw new Error('열린 문서가 없습니다')
  return st
}

function requireDoc(docId: number): mupdf.PDFDocument {
  return requireState(docId).doc
}

function invalidate(docId: number): void {
  docs.get(docId)?.stCache.clear()
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
  const doc = requireDoc(docId)
  return { canUndo: doc.canUndo(), canRedo: doc.canRedo() }
}

function getStructuredText(docId: number, page: number): mupdf.StructuredText {
  const st = requireState(docId)
  const cached = st.stCache.get(page)
  if (cached) return cached
  const text = st.doc.loadPage(page).toStructuredText('preserve-whitespace')
  st.stCache.set(page, text)
  return text
}

// ── 책갈피 ──

interface MupdfOutlineNode {
  title?: string
  uri?: string
  page?: number
  down?: MupdfOutlineNode[]
}

function readOutline(doc: mupdf.PDFDocument): BookmarkItem[] {
  const walk = (items: MupdfOutlineNode[] | undefined): BookmarkItem[] =>
    (items ?? []).map((it) => ({
      title: it.title ?? '(제목 없음)',
      page: it.page ?? (it.uri ? Math.max(0, doc.resolveLink(it.uri)) : 0),
      children: walk(it.down)
    }))
  return walk((doc.loadOutline() as MupdfOutlineNode[] | null) ?? undefined)
}

function writeOutline(docId: number, items: BookmarkItem[]): void {
  const doc = requireDoc(docId)
  const it = doc.outlineIterator()
  while (it.item()) it.delete()
  const insertLevel = (nodes: BookmarkItem[]): void => {
    for (const node of nodes) {
      it.insert({
        title: node.title,
        open: false,
        uri: doc.formatLinkURI({
          type: 'XYZ',
          chapter: 0,
          page: Math.min(node.page, doc.countPages() - 1),
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          zoom: 0
        })
      })
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

function docInfo(docId: number): DocInfo {
  const st = requireState(docId)
  const doc = st.doc
  const pageCount = doc.countPages()
  const pages = []
  for (let i = 0; i < pageCount; i++) {
    const [x0, y0, x1, y1] = doc.loadPage(i).getBounds()
    pages.push({ width: x1 - x0, height: y1 - y0 })
  }
  return {
    filePath: st.path,
    pageCount,
    pages,
    outline: readOutline(doc),
    title: st.path ? basename(st.path) : '제목 없음'
  }
}

// ── RPC 연산 ──

const ops: Record<string, (docId: number, args: any) => unknown> = {
  open(docId, { path }: { path: string }) {
    docs.get(docId)?.doc.destroy?.()
    const buf = readFileSync(path)
    const doc = mupdf.Document.openDocument(buf, 'application/pdf') as mupdf.PDFDocument
    doc.enableJournal() // Ctrl+Z/Ctrl+Shift+Z 되돌리기/다시하기
    docs.set(docId, { doc, path, stCache: new Map() })
    return docInfo(docId)
  },

  docInfo(docId) {
    return docInfo(docId)
  },

  render(docId, { page, scale }: { page: number; scale: number }) {
    const p = requireDoc(docId).loadPage(page)
    const pix = p.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
    const png = pix.asPNG()
    const result = { png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), width: pix.getWidth(), height: pix.getHeight() }
    pix.destroy()
    return result
  },

  selection(docId, { page, ax, ay, bx, by }: { page: number; ax: number; ay: number; bx: number; by: number }) {
    const st = getStructuredText(docId, page)
    const quads = st.highlight([ax, ay], [bx, by], 1000) as unknown as Quad[]
    const text = st.copy([ax, ay], [bx, by])
    return { quads, text }
  },

  search(docId, { needle, maxHits }: { needle: string; maxHits: number }) {
    const doc = requireDoc(docId)
    const hits: { page: number; quads: Quad[] }[] = []
    for (let i = 0; i < doc.countPages() && hits.length < maxHits; i++) {
      const found = getStructuredText(docId, i).search(needle) as unknown as Quad[][]
      for (const quads of found) {
        hits.push({ page: i, quads })
        if (hits.length >= maxHits) break
      }
    }
    return hits
  },

  addHighlight(docId, { page, quads, color, opacity }: { page: number; quads: Quad[]; color: [number, number, number]; opacity: number }) {
    return mutate(docId, 'highlight', () => {
      const p = requireDoc(docId).loadPage(page)
      // mupdf Highlight 주석은 끝이 둥글다 → quad별 테두리 없는 Square로 각진 형광펜 구현
      for (const q of quads) {
        const x0 = Math.min(q[0], q[4])
        const y0 = Math.min(q[1], q[3])
        const x1 = Math.max(q[2], q[6])
        const y1 = Math.max(q[5], q[7])
        const annot = p.createAnnotation('Square')
        annot.setRect([x0, y0, x1, y1])
        annot.setColor([]) // 테두리 없음
        annot.setInteriorColor(color)
        annot.setBorderWidth(0)
        annot.setOpacity(opacity)
        annot.update()
      }
      return { count: p.getAnnotations().length }
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
    const p = requireDoc(docId).loadPage(page)
    return p.getAnnotations().map((a, index) => ({
      index,
      type: a.getType(),
      rect: a.getBounds() as unknown as Rect
    }))
  },

  getLinks(docId, { page }: { page: number }): LinkInfo[] {
    const doc = requireDoc(docId)
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
    const p = requireDoc(docId).loadPage(page)
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
      writeOutline(docId, items)
      return docInfo(docId)
    })
  },

  undo(docId) {
    const doc = requireDoc(docId)
    if (doc.canUndo()) doc.undo()
    invalidate(docId)
    return { info: docInfo(docId), ...undoState(docId) }
  },

  redo(docId) {
    const doc = requireDoc(docId)
    if (doc.canRedo()) doc.redo()
    invalidate(docId)
    return { info: docInfo(docId), ...undoState(docId) }
  },

  undoState(docId) {
    return undoState(docId)
  },

  save(docId, { path }: { path: string }) {
    const st = requireState(docId)
    const buf = st.doc.saveToBuffer('garbage=compact')
    const bytes = buf.asUint8Array()
    const tmp = join(dirname(path), `.${basename(path)}.icepdf-tmp`)
    writeFileSync(tmp, bytes)
    renameSync(tmp, path)
    st.path = path
    return { path }
  },

  getPdfBuffer(docId) {
    const bytes = requireDoc(docId).saveToBuffer('garbage=compact').asUint8Array()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  },

  close(docId) {
    docs.get(docId)?.doc.destroy?.()
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
