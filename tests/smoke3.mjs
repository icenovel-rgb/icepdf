/** v0.4 기능 e2e — 슬라이드/전체화면/Del/표지/이미지폴더/OCR */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const magazine = path.join(root, 'samples', 'magazine.pdf')
const imgDir = path.join(root, 'spike', 'output', 'img-export')
fs.rmSync(imgDir, { recursive: true, force: true })

const results = []
let failed = 0
const report = (n, ok, d = '') => {
  results.push(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!ok) failed++
}

const app = await electron.launch({ args: ['.'], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // 확인/안내 팝업 자동 수락
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  })
  await win.evaluate((p) => window.__icepdf.actions.openFile(p), magazine)
  await win.waitForSelector('.page-view img', { timeout: 20000 })

  // VI 표지 보기: 두쪽+표지 → 첫 행 [빈칸, 1쪽]
  await win.evaluate(() => window.__icepdf.state().set({ spread: 2, cover: true }))
  await win.waitForTimeout(600)
  const firstRow = await win.evaluate(() => {
    const row = document.querySelector('.page-row')
    return { pages: row.querySelectorAll('.page-view').length, blanks: row.querySelectorAll('.page-blank').length }
  })
  report('VI 표지=오른쪽(빈칸+1쪽)', firstRow.pages === 1 && firstRow.blanks === 1, JSON.stringify(firstRow))
  await win.evaluate(() => window.__icepdf.state().set({ spread: 1 }))

  // VII 슬라이드 보기: 한 페이지 + 방향키 이동
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'slide' }))
  await win.waitForSelector('.slide-view .page-view img', { timeout: 10000 })
  await win.evaluate(() => window.__icepdf.state().gotoPage(2))
  await win.waitForTimeout(300)
  const before = await win.evaluate(() => window.__icepdf.state().currentPage)
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  await win.waitForTimeout(300)
  const after = await win.evaluate(() => window.__icepdf.state().currentPage)
  report('VII 슬라이드 방향키 이동', before === 2 && after === 3, `${before}→${after}`)
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'scroll' }))

  // b Tab=툴바만 숨김
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
  await win.waitForTimeout(200)
  const tabHidden = await win.evaluate(() => !document.querySelector('.toolbar') && !window.__icepdf.state().fullscreen)
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
  await win.waitForTimeout(200)
  const tabBack = await win.evaluate(() => !!document.querySelector('.toolbar'))
  report('b Tab 툴바만 숨김/복귀(전체화면 아님)', tabHidden && tabBack, '')

  // a 손툴: 스페이스 keydown이 기본 스크롤을 막고 panMode on
  const pan = await win.evaluate(() => {
    const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    const blocked = e.defaultPrevented
    const on = window.__icepdf.state().panMode
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
    return { blocked, on }
  })
  report('a 스페이스 기본스크롤 차단 + panMode', pan.blocked && pan.on, JSON.stringify(pan))

  // V Del키로 삽입 이미지 삭제
  const delResult = await win.evaluate(async () => {
    const cv = document.createElement('canvas')
    cv.width = 80
    cv.height = 80
    cv.getContext('2d').fillRect(0, 0, 80, 80)
    const data = await (await new Promise((r) => cv.toBlob(r, 'image/png'))).arrayBuffer()
    window.__icepdf.state().set({ pendingImage: { path: '', data, naturalW: 80, naturalH: 80 } })
    await window.__icepdf.actions.placeImage(0, [120, 120, 240, 240])
    const had = (await window.icepdf.engine('listAnnots', { page: 0 })).length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    const now = (await window.icepdf.engine('listAnnots', { page: 0 })).length
    const sel = window.__icepdf.state().selectedImage
    return { had, now, sel }
  })
  report('V Del키로 개체 삭제', delResult.had >= 1 && delResult.now === delResult.had - 1 && !delResult.sel, JSON.stringify(delResult))

  // I 폴더에 이미지로 내보내기 (5쪽만 가진 작은 문서면 좋지만 잡지로; 시간 절약 위해 직접 호출)
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, imgDir)
  await win.evaluate(() => window.__icepdf.actions.exportImagesToFolder())
  await win.waitForFunction(() => window.__icepdf.state().busy === null, { timeout: 120000 })
  await win.waitForTimeout(500)
  const pngCount = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).filter((f) => f.endsWith('.png')).length : 0
  report('I 폴더 이미지 내보내기', pngCount === 86, `${pngCount} PNG`)

  // III OCR 텍스트 레이어 (단어 박스) — 선택 가능한 .ocr-word 스팬 생성
  await win.evaluate(() => window.__icepdf.state().gotoPage(29))
  await win.waitForTimeout(300)
  await win.evaluate(() => window.__icepdf.actions.ocrCurrentPage())
  await win.waitForFunction(() => window.__icepdf.state().busy === null, { timeout: 60000 })
  await win.waitForTimeout(500)
  const layerWords = await win.evaluate(() => (window.__icepdf.state().ocrLayers[29] ?? []).length)
  await win.waitForTimeout(300)
  const domSpans = await win.locator('.ocr-word').count()
  report('III OCR 선택가능 텍스트 레이어', layerWords > 10 && domSpans > 0, `words=${layerWords}, spans=${domSpans}`)
} finally {
  await app.close()
}

console.log(results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
