/** 패키징된 앱(win-unpacked) 검증 — 의존성 동봉 + 이미지 포함 HWPX 변환 실제 동작 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const exe = path.join(root, 'release', 'win-unpacked', 'ICEPDF.exe')
const magazine = path.join(root, 'samples', 'magazine.pdf')
const outDir = path.join(root, 'spike', 'output')
const hwpxPath = path.join(outDir, 'packaged-magazine.hwpx')
if (fs.existsSync(hwpxPath)) fs.unlinkSync(hwpxPath)

if (!fs.existsSync(exe)) {
  console.error('FAIL: win-unpacked 빌드가 없습니다:', exe)
  process.exit(1)
}

let failed = 0
const report = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

const app = await electron.launch({ executablePath: exe })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, hwpxPath)

  await win.evaluate((p) => window.__icepdf.actions.openFile(p), magazine)
  await win.waitForSelector('.page-view img', { timeout: 25000 })
  const info = await win.evaluate(() => window.__icepdf.state().info)
  report('패키징: 잡지 열기 + 렌더', !!info && info.pageCount === 86, `pages=${info?.pageCount}`)

  await win.evaluate(() => window.__icepdf.actions.exportDoc('hwpx'))
  await win.waitForFunction(() => window.__icepdf.state().busy === null, { timeout: 120000 })
  await win.waitForTimeout(800)

  const ok = fs.existsSync(hwpxPath) && fs.readFileSync(hwpxPath).subarray(0, 2).toString() === 'PK'
  report('패키징: HWPX 생성', ok, ok ? `${fs.statSync(hwpxPath).size} bytes` : '없음')
  if (ok) {
    const zip = await JSZip.loadAsync(fs.readFileSync(hwpxPath))
    const bin = Object.keys(zip.files).filter((f) => f.startsWith('BinData/') && !zip.files[f].dir)
    const xml = await zip.file('Contents/section0.xml').async('string')
    const pics = (xml.match(/<hp:pic\b/g) ?? []).length
    report('패키징: HWPX에 이미지 임베드(#10)', bin.length > 5 && pics === bin.length, `BinData ${bin.length}, pic ${pics}`)
  }

  // OCR (패키징 환경에서 tesseract.js 코어 로드 + 언어데이터 다운로드/캐시)
  await win.evaluate(() => window.__icepdf.state().gotoPage(29))
  await win.evaluate(() => window.__icepdf.actions.ocrCurrentPage())
  await win.waitForFunction(() => window.__icepdf.state().busy === null, { timeout: 90000 })
  await win.waitForTimeout(500)
  const words = await win.evaluate(() => (window.__icepdf.state().ocrLayers[29] ?? []).length)
  report('패키징: OCR 텍스트 레이어(#III)', words > 10, `words=${words}`)
} finally {
  await app.close()
}

process.exit(failed ? 1 : 0)
