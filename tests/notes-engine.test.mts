/**
 * 밑줄 엔진 통합 검증 (실제 mupdf) —
 * EPUB: 선택 → 앵커 → 글자 크기 변경(재배치) 후에도 같은 문장을 찾는지 / 테마 CSS가 쪽 수를 바꾸지 않는지
 * PDF: 형광펜 그룹(원문·스타일 저장) → 목록 → 그룹 삭제 → 저장 후 다시 열어도 목록 유지
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import { openEngineDoc, relayoutEpub } from '../src/main/engine/open'
import { addPdfHighlight, anchorForQuads, deletePdfHighlight, listPdfHighlights, pageText, resolveNotes } from '../src/main/engine/notes'
import { EPUB_THEMES } from '../src/shared/reading'
import type { Quad } from '../src/shared/types'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const epubPath = path.join(root, 'samples', 'sample.epub')
const pdfPath = path.join(root, 'samples', 'sample.pdf')

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

const textGetter = (doc: mupdf.Document) => (p: number) =>
  p >= 0 && p < doc.countPages() ? pageText(doc.loadPage(p).toStructuredText('preserve-whitespace')) : null
const textOnly = (doc: mupdf.Document) => (p: number) => textGetter(doc)(p)?.text ?? ''

// ── EPUB 앵커: 재배치 후에도 같은 문장 ──
const epub = openEngineDoc(epubPath, readFileSync(epubPath)).doc
const n14 = epub.countPages()
const page = 2
const pt = textGetter(epub)(page)!
// 쪽 가운데쯤 한 줄을 선택 (그 줄 글자들의 쿼드)
const midLine = pt.chars[Math.floor(pt.chars.length / 2)].line
const lineQuads = pt.chars.filter((c) => c.line === midLine).map((c) => c.quad) as Quad[]
const sel = epub.loadPage(page).toStructuredText('preserve-whitespace')
const first = lineQuads[0]
const last = lineQuads[lineQuads.length - 1]
const quads = sel.highlight([first[0] + 1, first[1] + 2], [last[2] - 1, last[7] - 2]) as unknown as Quad[]
const anchor = anchorForQuads(textOnly(epub), textGetter(epub), page, n14, quads)
check('선택 → 앵커 생성', !!anchor && anchor.exact.length > 5, anchor?.exact)
check('앞뒤 문맥 저장', !!anchor && anchor.prefix.length > 0 && anchor.suffix.length > 0)

const before = resolveNotes(textOnly(epub), textGetter(epub), n14, [{ id: 'a', anchor: anchor! }])[0]
check('같은 레이아웃에서 원래 쪽', before.marks[0]?.page === page, JSON.stringify(before.marks.map((m) => m.page)))
check('표시 사각형 있음', (before.marks[0]?.rects.length ?? 0) >= 1)

relayoutEpub(epub, 22)
const n22 = epub.countPages()
check('22pt 재배치로 쪽 수 증가', n22 > n14, `${n14} → ${n22}`)
const after = resolveNotes(textOnly(epub), textGetter(epub), n22, [{ id: 'a', anchor: anchor! }])[0]
check('재배치 후에도 찾음', after.marks.length >= 1, JSON.stringify(after.marks.map((m) => m.page)))
const foundText = after.marks
  .map((m) => {
    const t = textGetter(epub)(m.page)!
    return t.text
  })
  .join('')
check('찾은 쪽에 그 문장이 있음', foundText.includes(anchor!.exact.slice(0, 8)))

const missing = resolveNotes(textOnly(epub), textGetter(epub), n22, [{ id: 'x', anchor: { exact: '책에없는문장입니다', prefix: '', suffix: '', ratio: 0.3 } }])[0]
check('없는 문장 → 빈 표시', missing.marks.length === 0)

// ── 테마 CSS: 쪽 수 불변 + 실제로 색이 바뀜 ──
// mupdf는 장을 처음 그릴 때의 CSS를 붙잡아 두므로(다시 배치해도 반영 안 됨) 새로 열어서 확인한다
const epubBytes = readFileSync(epubPath)
const cornerOf = (doc: mupdf.Document): number[] => {
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(0.2, 0.2), mupdf.ColorSpace.DeviceRGB, false, true)
  const px = pix.getPixels()
  return [px[0], px[1], px[2]]
}
const plainDoc = openEngineDoc(epubPath, epubBytes).doc
const plain = plainDoc.countPages()
check('화이트 = 흰 바탕', cornerOf(plainDoc).every((v) => v === 255))
const expectCorner = { sepia: [244, 236, 216], dark: [30, 30, 30] }
for (const theme of ['sepia', 'dark'] as const) {
  mupdf.setUserCSS(EPUB_THEMES[theme].css)
  const themed = openEngineDoc(epubPath, epubBytes).doc
  check(`${theme} 테마 쪽 수 그대로`, themed.countPages() === plain, `${plain} → ${themed.countPages()}`)
  check(`${theme} 테마 바탕색 적용`, JSON.stringify(cornerOf(themed)) === JSON.stringify(expectCorner[theme]), JSON.stringify(cornerOf(themed)))
  mupdf.setUserCSS('')
  check(`${theme}: 이미 그린 장은 CSS를 바꿔도 그대로 (그래서 테마 전환 = 다시 열기)`, JSON.stringify(cornerOf(themed)) === JSON.stringify(expectCorner[theme]))
}
check('먼저 연 문서는 원래 색 유지 (문서마다 연 시점의 CSS)', cornerOf(plainDoc).every((v) => v === 255))

// ── PDF 형광펜 그룹 ──
const pdf = openEngineDoc(pdfPath, readFileSync(pdfPath)).pdf!
/** 앱(worker mutate)과 같이 저널 트랜잭션 안에서 실행 */
const op = <T,>(fn: () => T): T => {
  pdf.beginOperation('test')
  try {
    return fn()
  } finally {
    pdf.endOperation()
  }
}
const q: Quad = [72, 100, 200, 100, 72, 114, 200, 114]
const q2: Quad = [72, 120, 160, 120, 72, 134, 160, 134]
op(() => addPdfHighlight(pdf, 0, { quads: [q, q2], color: [1, 0.878, 0.302], opacity: 0.45, style: 'highlight', text: '한글 형광펜 원문', id: 'hl-1000-aaa' }))
op(() => addPdfHighlight(pdf, 0, { quads: [q], color: [0.494, 0.784, 1], opacity: 0.45, style: 'underline', text: 'underline me', id: 'hl-2000-bbb' }))
const list = listPdfHighlights(pdf)
check('그룹 2개 (quad 3개)', list.length === 2, JSON.stringify(list))
check('원문·색·스타일 보존', list[0].text === '한글 형광펜 원문' && list[0].color === '#ffe04d' && list[1].style === 'underline', JSON.stringify(list))
check('생성 시각 = id의 타임스탬프', list[0].createdAt === 1000)
const ul = pdf.loadPage(0).getAnnotations().find((a) => a.getContents() === 'underline me')!
const [, uy0, , uy1] = ul.getBounds()
check('밑줄은 얇은 띠', uy1 - uy0 < 5, `${(uy1 - uy0).toFixed(2)}pt`)

// 저장 → 다시 열어도 목록 유지
const saved = pdf.saveToBuffer('garbage=compact')
const reopened = mupdf.Document.openDocument(saved, 'application/pdf') as mupdf.PDFDocument
check('저장 후 다시 열어도 유지', listPdfHighlights(reopened).length === 2)

check('그룹 삭제 → 그 그룹의 Square 2개 제거', op(() => deletePdfHighlight(pdf, 'hl-1000-aaa')) === 2)
check('남은 그룹 1개', listPdfHighlights(pdf).length === 1)
pdf.undo()
check('실행취소로 삭제한 그룹 복구', listPdfHighlights(pdf).length === 2)

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
