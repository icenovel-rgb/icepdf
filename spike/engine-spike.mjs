/**
 * mupdf.js 엔진 스파이크 — ICEPDF가 의존하는 모든 API를 검증한다.
 * 실패 항목이 있으면 exit 1.
 */
import * as mupdf from 'mupdf'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output')
fs.mkdirSync(OUT, { recursive: true })

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: String(detail ?? '') })
  } catch (err) {
    results.push({ name, ok: false, detail: err.message })
  }
}

// ── 샘플 PDF 생성 (3페이지, 텍스트 포함) ──
const A4 = [0, 0, 595, 842]
function makeSampleDoc(label) {
  const doc = new mupdf.PDFDocument()
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'))
  for (let i = 1; i <= 3; i++) {
    const resources = doc.addObject({ Font: { F1: font } })
    const contents = `BT /F1 24 Tf 72 720 Td (${label} Page ${i} Hello ICEPDF) Tj ET`
    const page = doc.addPage(A4, 0, resources, contents)
    doc.insertPage(-1, page)
  }
  return doc
}

let doc
check('1. 빈 PDFDocument 생성 + addPage/insertPage', () => {
  doc = makeSampleDoc('Main')
  if (doc.countPages() !== 3) throw new Error(`pageCount=${doc.countPages()}`)
  return '3 pages'
})

let pngBuffer
check('2. 페이지 렌더링 toPixmap → PNG', () => {
  const page = doc.loadPage(0)
  const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB)
  pngBuffer = pix.asPNG()
  fs.writeFileSync(path.join(OUT, 'render.png'), Buffer.from(pngBuffer))
  if (pngBuffer.byteLength < 1000) throw new Error('PNG too small')
  return `${pngBuffer.byteLength} bytes`
})

check('3. StructuredText asJSON (텍스트 추출)', () => {
  const page = doc.loadPage(0)
  const json = JSON.parse(page.toStructuredText().asJSON())
  const text = JSON.stringify(json)
  if (!text.includes('ICEPDF')) throw new Error('text not found')
  return 'contains ICEPDF'
})

let fitzYDown = null // 좌표계 판별 결과 (true = 좌상단 원점 y-down)
check('4. 드래그 선택: StructuredText.highlight + copy (+좌표계 판별)', () => {
  const page = doc.loadPage(0)
  const st = page.toStructuredText()
  // 텍스트는 PDF 좌표(y-up) baseline 720에 그려짐.
  // fitz y-down이면 y≈842-720=122 부근, PDF y-up 그대로면 y≈710-730 부근.
  const tryYDown = { a: [60, 100], b: [450, 140] }
  const tryYUp = { a: [60, 705], b: [450, 740] }
  for (const [label, { a, b }] of [['y-down', tryYDown], ['y-up', tryYUp]]) {
    const quads = st.highlight(a, b)
    const text = st.copy(a, b)
    if (quads.length && text.includes('Hello')) {
      fitzYDown = label === 'y-down'
      return `좌표계=${label}, ${quads.length} quads, copied "${text.trim()}"`
    }
  }
  throw new Error('어느 좌표 해석으로도 선택 실패')
})

check('5. 검색 page.search', () => {
  const page = doc.loadPage(0)
  const hits = page.search('ICEPDF')
  if (!hits.length) throw new Error('no hits')
  return `${hits.length} hit(s)`
})

check('6. 형광펜 주석 createAnnotation(Highlight) + quadPoints + 색상', () => {
  const page = doc.loadPage(0)
  const st = page.toStructuredText()
  const [a, b] = fitzYDown ? [[60, 100], [450, 140]] : [[60, 705], [450, 740]]
  const quads = st.highlight(a, b)
  const annot = page.createAnnotation('Highlight')
  annot.setQuadPoints(quads)
  annot.setColor([1, 1, 0])
  annot.setOpacity(0.5)
  annot.update()
  const n = page.getAnnotations().length
  if (n !== 1) throw new Error(`annots=${n}`)
  return 'highlight annot created'
})

check('7. 이미지 삽입 Stamp 주석 + setStampImage', () => {
  const page = doc.loadPage(1)
  const annot = page.createAnnotation('Stamp')
  annot.setRect([100, 400, 300, 550])
  annot.setStampImage(new mupdf.Image(pngBuffer))
  annot.update()
  const before = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB).asPNG().byteLength
  if (page.getAnnotations().length !== 1) throw new Error('annot missing')
  return `stamp image annot OK (render ${before} bytes)`
})

check('8. 빈 페이지 삽입', () => {
  const blank = doc.addPage(A4, 0, doc.addObject({}), '')
  doc.insertPage(1, blank)
  if (doc.countPages() !== 4) throw new Error(`pageCount=${doc.countPages()}`)
  return 'now 4 pages'
})

check('9. 다른 PDF에서 페이지 가져오기 graftPage', () => {
  const src = makeSampleDoc('Other')
  doc.graftPage(2, src, 0)
  if (doc.countPages() !== 5) throw new Error(`pageCount=${doc.countPages()}`)
  return 'now 5 pages'
})

check('10. 페이지 삭제 deletePage', () => {
  doc.deletePage(1)
  if (doc.countPages() !== 4) throw new Error(`pageCount=${doc.countPages()}`)
  return 'back to 4 pages'
})

check('11. 책갈피 쓰기 outlineIterator.insert', () => {
  const it = doc.outlineIterator()
  it.insert({ title: '첫 페이지 북마크', uri: doc.formatLinkURI({ type: 'XYZ', page: 0 }) })
  it.insert({ title: 'Grafted 페이지', uri: doc.formatLinkURI({ type: 'XYZ', page: 1 }) })
  const outline = doc.loadOutline()
  if (!outline || outline.length !== 2) throw new Error(`outline len=${outline?.length}`)
  return `outline: ${outline.map((o) => o.title).join(' / ')}`
})

check('12. 책갈피 → 페이지 번호 해석 resolveLink', () => {
  const outline = doc.loadOutline()
  const pageNo = doc.resolveLink(outline[1].uri)
  if (pageNo !== 1) throw new Error(`resolved=${pageNo}`)
  return `'${outline[1].title}' → page ${pageNo}`
})

let savedPath
check('13. 저장 saveToBuffer', () => {
  const buf = doc.saveToBuffer('garbage=compact')
  savedPath = path.join(OUT, 'sample-edited.pdf')
  fs.writeFileSync(savedPath, Buffer.from(buf.asUint8Array()))
  return `${buf.asUint8Array().byteLength} bytes`
})

check('14. 재열기 검증 (페이지 수/책갈피/주석 유지)', () => {
  const re = mupdf.Document.openDocument(fs.readFileSync(savedPath), 'application/pdf')
  const pages = re.countPages()
  const outline = re.loadOutline()
  const annots = re.loadPage(0).getAnnotations().length
  if (pages !== 4) throw new Error(`pages=${pages}`)
  if (!outline || outline.length !== 2) throw new Error(`outline=${outline?.length}`)
  if (annots !== 1) throw new Error(`annots=${annots}`)
  return `pages=4, outline=2, highlight=1 모두 유지`
})

check('15. 한글 텍스트 페이지 생성+추출 (CJK 폰트)', () => {
  const kdoc = new mupdf.PDFDocument()
  const font = kdoc.addCJKFont(new mupdf.Font('ko'), 'ko', 0, true)
  const resources = kdoc.addObject({ Font: { K1: font } })
  const contents = 'BT /K1 20 Tf 72 720 Td <AC00B098B2E4> Tj ET'
  const page = kdoc.addPage(A4, 0, resources, contents)
  kdoc.insertPage(-1, page)
  const text = kdoc.loadPage(0).toStructuredText().asText()
  if (!text.includes('가나다')) throw new Error(`extracted: "${text.trim()}"`)
  return `한글 추출 OK: "${text.trim()}"`
})

// ── 결과 출력 ──
let fails = 0
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL'
  if (!r.ok) fails++
  console.log(`[${mark}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
}
console.log(`\n${results.length - fails}/${results.length} passed`)
process.exit(fails ? 1 : 0)
