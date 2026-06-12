/**
 * 실전 한국어 PDF 변환 검증:
 * Electron printToPDF로 ToUnicode CMap이 정상 포함된 한국어 PDF 생성 →
 * kordoc PDF→Markdown→HWPX 파이프라인 품질 확인.
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const samplePath = path.join(root, 'samples', 'korean.pdf')

const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><body style="font-family: 'Malgun Gothic'">
<h1>공문서 변환 시험</h1>
<p>이 문서는 ICEPDF의 한글 변환 파이프라인을 검증하기 위한 표본입니다. 아크로벳 리더의 핵심 기능과 한글 문서 변환을 함께 시험합니다.</p>
<h2>1. 추진 배경</h2>
<p>PDF 문서를 한글(HWPX) 문서와 마크다운으로 변환하는 기능이 필요하다.</p>
<h2>2. 세부 내용</h2>
<table border="1" style="border-collapse:collapse"><tr><th>항목</th><th>내용</th></tr>
<tr><td>대상</td><td>한국 공문서</td></tr><tr><td>형식</td><td>HWPX, Markdown</td></tr></table>
<p>붙임: 변환 결과 1부. 끝.</p>
</body></html>`

const app = await electron.launch({ args: ['.'], cwd: root })
const pdfB64 = await app.evaluate(async ({ BrowserWindow }, html) => {
  const w = new BrowserWindow({ show: false })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const buf = await w.webContents.printToPDF({ printBackground: true })
  w.destroy()
  return buf.toString('base64')
}, html)
await app.close()
fs.writeFileSync(samplePath, Buffer.from(pdfB64, 'base64'))
console.log(`한국어 샘플 생성: ${samplePath} (${Buffer.from(pdfB64, 'base64').length} bytes)`)

// kordoc 변환 검증
const { parsePdf, markdownToHwpx } = await import('kordoc')
const pdfBuf = fs.readFileSync(samplePath)
const result = await parsePdf(pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength))
if (!result.success) {
  console.error('FAIL: 파싱 실패', result.error)
  process.exit(1)
}
const md = result.markdown
const checks = [
  ['한글 본문 추출', md.includes('공문서') && md.includes('추진 배경')],
  ['헤딩 구조(#) 감지', /^#{1,3} /m.test(md)],
  ['표 변환', md.includes('|') && md.includes('항목')]
]
const hwpx = await markdownToHwpx(md)
const JSZip = (await import('jszip')).default
const zip = await JSZip.loadAsync(hwpx)
const section = await zip.file('Contents/section0.xml').async('string')
checks.push(['HWPX에 한글 포함', section.includes('공문서')])

let failed = 0
for (const [name, ok] of checks) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`)
  if (!ok) failed++
}
console.log('\n--- 변환된 Markdown 미리보기 ---\n' + md.slice(0, 400))
process.exit(failed ? 1 : 0)
