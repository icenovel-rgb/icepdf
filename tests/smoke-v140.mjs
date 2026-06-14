/**
 * v1.4.0 검증: undo/redo + 텍스트 재편집(폰트/크기/색상/내용) + 비례 크기조절(글자 변형 없음).
 * 사전: npm run build
 */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')

let failed = 0
const report = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stamps = (win) =>
  win.evaluate(() =>
    window.icepdf
      .engine(window.__icepdf.state().activeDocId, 'listAnnots', { page: 0 })
      .then((a) => a.filter((x) => x.type === 'Stamp').length)
  )
const sel = (win) => win.evaluate(() => window.__icepdf.state().selectedImage)

const app = await electron.launch({ args: ['.', sample], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.page-canvas', { timeout: 20000 })

  // ── 텍스트 추가 (UI 클릭) ──
  await win.evaluate(() => window.__icepdf.state().set({ tool: 'text' }))
  await win.locator('.page-view').first().click({ position: { x: 90, y: 90 } })
  await sleep(300)
  await win.locator('.text-draft').fill('재편집 Text')
  await win.locator('.page-view').first().click({ position: { x: 330, y: 330 } })
  await sleep(600)
  report('텍스트 추가 → Stamp 1개', (await stamps(win)) === 1)
  const s1 = await sel(win)
  report('텍스트 메타(content/size) 보존', !!s1?.text && s1.text.content === '재편집 Text', `size=${s1?.text?.size}`)
  const canUndo1 = await win.evaluate(() => window.__icepdf.state().canUndo)
  report('추가 후 canUndo=true', canUndo1 === true)

  // ── 폰트 크기/색상 수정 (재편집) ──
  await win.evaluate(() => window.__icepdf.actions.updateSelectedTextStyle({ size: 44, color: '#1133ff' }))
  await sleep(500)
  const s2 = await sel(win)
  report('크기/색상 수정 반영', s2?.text?.size === 44 && s2?.text?.color === '#1133ff')
  report('수정해도 Stamp 1개 유지(인덱스 교체 아님)', (await stamps(win)) === 1 && s2?.index === s1?.index)
  // 글자 변형 없음: 표시 박스 종횡비 == 렌더 비트맵 종횡비
  const aspectMatch2 = Math.abs(s2.w0 / s2.h0 - s2.naturalW / s2.naturalH) < 0.02
  report('수정 후 글자 변형 없음(박스=비트맵 종횡비)', aspectMatch2)

  // ── 비례 크기조절 (글자 변형 금지) ──
  const beforeAspect = s2.w0 / s2.h0
  await win.evaluate(() => window.__icepdf.actions.applyTextResize(1.5))
  await sleep(500)
  const s3 = await sel(win)
  report('비례 리사이즈 → 폰트 크기 1.5배', s3?.text?.size === Math.round(44 * 1.5), `size=${s3?.text?.size}`)
  const aspectMatch3 = Math.abs(s3.w0 / s3.h0 - beforeAspect) < 0.05
  report('리사이즈 후 종횡비 유지(글자 안 늘어남)', aspectMatch3, `${beforeAspect.toFixed(3)}→${(s3.w0 / s3.h0).toFixed(3)}`)

  // ── 내용 재편집 ──
  await win.evaluate(() => {
    const s = window.__icepdf.state()
    return window.__icepdf.actions.rerenderText(s.selectedImage, { ...s.selectedImage.text, content: '바뀐 내용 OK' })
  })
  await sleep(500)
  const s4 = await sel(win)
  report('내용 재편집 반영', s4?.text?.content === '바뀐 내용 OK')

  // ── undo / redo ──
  await win.evaluate(() => window.__icepdf.actions.undo())
  await sleep(500)
  report('undo 1회 → 내용 직전으로', (await sel(win)) === null && (await stamps(win)) === 1)
  // 텍스트 추가까지 전부 되돌리기
  let guard = 0
  while ((await win.evaluate(() => window.__icepdf.state().canUndo)) && guard++ < 10) {
    await win.evaluate(() => window.__icepdf.actions.undo())
    await sleep(250)
  }
  report('전부 undo → Stamp 0개', (await stamps(win)) === 0)
  const canRedo = await win.evaluate(() => window.__icepdf.state().canRedo)
  report('undo 후 canRedo=true', canRedo === true)
  await win.evaluate(() => window.__icepdf.actions.redo())
  await sleep(400)
  report('redo 1회 → Stamp 다시 1개', (await stamps(win)) === 1)
} catch (err) {
  report('예외 발생', false, String(err))
} finally {
  await app.close().catch(() => {})
}

console.log(failed ? `\n${failed}건 실패` : '\n전체 통과')
process.exit(failed ? 1 : 0)
