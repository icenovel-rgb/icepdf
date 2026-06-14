/** v1.5.0 검증: 맨 앞으로/맨 뒤로 (z-순서) — 겹친 빨강·파랑 이미지로 페인트 순서 확인 */
import { _electron as electron } from 'playwright-core'
import sharp from 'sharp'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')
// 픽스처는 런타임 생성(바이너리 미커밋)
const red = path.join(os.tmpdir(), 'icepdf-zorder-red.png')
const blue = path.join(os.tmpdir(), 'icepdf-zorder-blue.png')
await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 230, g: 30, b: 40, alpha: 1 } } }).png().toFile(red)
await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 30, g: 60, b: 230, alpha: 1 } } }).png().toFile(blue)

let fail = 0
const report = (n, ok, d = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({ args: ['.', sample], cwd: root })
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()) })
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('.page-canvas', { timeout: 20000 })
const setDialog = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, p)

// 겹친 두 이미지의 공통 영역(150,150) 색을 본다
const overlapColor = () => win.evaluate(async () => {
  const s = window.__icepdf.state()
  const rr = await window.icepdf.engine(s.activeDocId, 'render', { page: 0, scale: 1 })
  const bmp = await createImageBitmap(new Blob([rr.png], { type: 'image/png' }))
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  return Array.from(c.getContext('2d').getImageData(150, 150, 1, 1).data).slice(0, 3)
})
const isRed = (c) => Math.abs(c[0] - 230) < 50 && c[2] < 90
const isBlue = (c) => c[2] > 150 && c[0] < 90

const box = await win.locator('.page-view').first().boundingBox()
async function insert(p, from, to) {
  await setDialog(p)
  await win.evaluate(() => window.__icepdf.actions.armImageTool()); await sleep(400)
  await win.mouse.move(box.x + from[0], box.y + from[1]); await win.mouse.down(); await win.mouse.move(box.x + to[0], box.y + to[1], { steps: 10 }); await win.mouse.up()
  await sleep(700)
}

// 빨강(아래) → 파랑(위) 겹치게
await insert(red, [60, 60], [180, 180])
await insert(blue, [120, 120], [240, 240])
report('초기: 파랑이 위(나중 삽입)', isBlue(await overlapColor()), JSON.stringify(await overlapColor()))

// 파랑 선택 상태 → 맨 뒤로 → 빨강이 위
await win.evaluate(() => window.__icepdf.actions.sendToBack()); await sleep(700)
report('파랑 맨 뒤로 → 빨강이 위', isRed(await overlapColor()), JSON.stringify(await overlapColor()))
report('맨 뒤로 후 선택 유지', await win.evaluate(() => !!window.__icepdf.state().selectedImage))

// 다시 맨 앞으로 → 파랑이 위
await win.evaluate(() => window.__icepdf.actions.bringToFront()); await sleep(700)
report('파랑 맨 앞으로 → 파랑이 위', isBlue(await overlapColor()), JSON.stringify(await overlapColor()))

// undo → 직전(맨 뒤로 상태)로 = 빨강이 위
await win.evaluate(() => window.__icepdf.actions.undo()); await sleep(600)
report('undo → 빨강이 위 (순서변경 되돌림)', isRed(await overlapColor()), JSON.stringify(await overlapColor()))

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
await app.close().catch(() => {})
process.exit(fail ? 1 : 0)
