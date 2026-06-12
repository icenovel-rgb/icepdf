/** 테스트용 샘플 PDF 생성 — 6페이지, 영문+한글 텍스트 */
import * as mupdf from 'mupdf'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'samples')
fs.mkdirSync(outDir, { recursive: true })

const A4 = [0, 0, 595, 842]
const doc = new mupdf.PDFDocument()
const helv = doc.addSimpleFont(new mupdf.Font('Helvetica'))
const bold = doc.addSimpleFont(new mupdf.Font('Helvetica-Bold'))
const cjk = doc.addCJKFont(new mupdf.Font('ko'), 'ko', 0, true)

function utf16beHex(s) {
  let hex = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    hex += code.toString(16).padStart(4, '0')
  }
  return hex
}

for (let i = 1; i <= 6; i++) {
  const resources = doc.addObject({ Font: { F1: helv, F2: bold, K1: cjk } })
  const lines = [
    `BT /F2 22 Tf 72 760 Td (Chapter ${i}: ICEPDF Sample Document) Tj ET`,
    `BT /F1 12 Tf 72 720 Td (This is page ${i} of the sample. The quick brown fox jumps over the lazy dog.) Tj ET`,
    `BT /F1 12 Tf 72 700 Td (Select this text with the mouse to test text selection and highlighting.) Tj ET`,
    `BT /K1 14 Tf 72 660 Td <${utf16beHex(`${i}장 한글 텍스트 추출 시험 문단입니다.`)}> Tj ET`,
    `BT /K1 12 Tf 72 636 Td <${utf16beHex('아크로벳 리더처럼 텍스트를 선택하고 형광펜을 칠할 수 있습니다.')}> Tj ET`,
    `BT /F1 48 Tf 250 380 Td (${i}) Tj ET`
  ]
  const page = doc.addPage(A4, 0, resources, lines.join('\n'))
  doc.insertPage(-1, page)
}

const buf = doc.saveToBuffer('garbage=compact')
const out = path.join(outDir, 'sample.pdf')
fs.writeFileSync(out, Buffer.from(buf.asUint8Array()))
console.log(`샘플 생성: ${out} (${doc.countPages()}p)`)
