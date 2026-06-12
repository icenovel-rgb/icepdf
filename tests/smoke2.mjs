/**
 * v0.2 기능 e2e — 실제 잡지 PDF로 새 기능 검증.
 * 사전: npm run build, samples/magazine.pdf 존재
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'spike', 'output')
fs.mkdirSync(outDir, { recursive: true })
const magazine = path.join(root, 'samples', 'magazine.pdf')

const results = []
let failed = 0
const report = (name, ok, detail = '') => {
  results.push(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

const app = await electron.launch({ args: ['.'], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await win.evaluate((p) => window.__icepdf.actions.openFile(p), magazine)
  await win.waitForSelector('.page-view img', { timeout: 20000 })
  const pageCount = await win.evaluate(() => window.__icepdf.state().info?.pageCount)
  report('문서 열기 (잡지 86p)', pageCount === 86, `pageCount=${pageCount}`)

  // #2 썸네일: 초기 1~3p 썸네일 이미지가 렌더되는가
  await win.waitForSelector('.thumb img', { timeout: 10000 })
  await win.waitForTimeout(800)
  const thumbImgs = await win.locator('.thumb img').count()
  report('#2 초기 썸네일 렌더', thumbImgs >= 3, `${thumbImgs}개 이미지`)

  // #3 이전 버튼: 5p로 이동 후 이전 버튼 클릭 → 4p
  await win.evaluate(() => window.__icepdf.state().gotoPage(5))
  await win.waitForTimeout(400)
  const before = await win.evaluate(() => window.__icepdf.state().currentPage)
  await win.locator('button[title="이전 쪽"]').click()
  await win.waitForTimeout(500)
  const after = await win.evaluate(() => window.__icepdf.state().currentPage)
  report('#3 이전 버튼 동작', before === 5 && after === 4, `${before} → ${after}`)

  // #6 쪽맞춤: 클릭 시 페이지 전체가 뷰포트 높이에 들어오는 zoom
  await win.locator('button[title^="쪽 맞춤"]').click()
  await win.waitForTimeout(400)
  const fit = await win.evaluate(() => {
    const s = window.__icepdf.state()
    const page = s.info.pages[s.currentPage]
    const vh = document.querySelector('.viewer').clientHeight
    return { zoom: s.zoom, pageCssH: page.height * s.zoom, vh }
  })
  report('#6 쪽맞춤', fit.pageCssH <= fit.vh + 2, `pageH=${Math.round(fit.pageCssH)} <= vh=${fit.vh}`)

  // #11 두쪽 보기: page-row 안에 페이지 2개
  await win.locator('button[title="두쪽 보기"]').click()
  await win.waitForTimeout(600)
  const maxInRow = await win.evaluate(() =>
    Math.max(...[...document.querySelectorAll('.page-row')].map((r) => r.querySelectorAll('.page-view').length))
  )
  report('#11 두쪽 보기', maxInRow === 2, `행당 최대 ${maxInRow}쪽`)
  await win.locator('button[title="한쪽 보기"]').click()
  await win.waitForTimeout(300)

  // #4 사이드바 리사이즈: 너비 키우면 썸네일 폭 커짐
  const thumbW1 = await win.evaluate(() => document.querySelector('.thumb img')?.clientWidth ?? 0)
  await win.evaluate(() => window.__icepdf.state().set({ sidebarWidth: 360 }))
  await win.waitForTimeout(600)
  const thumbW2 = await win.evaluate(() => document.querySelector('.thumb img')?.clientWidth ?? 0)
  report('#4 사이드바 리사이즈 → 썸네일 확대', thumbW2 > thumbW1 + 20, `${thumbW1}px → ${thumbW2}px`)
  await win.evaluate(() => window.__icepdf.state().set({ sidebarWidth: 210 }))

  // #7 지우개: 형광펜 추가 후 지우개로 삭제
  await win.evaluate(async () => {
    const s = window.__icepdf.state()
    const sel = await window.icepdf.engine('selection', { page: 0, ax: 20, ay: 20, bx: 580, by: 300 })
    s.set({ selection: { page: 0, quads: sel.quads, text: sel.text }, highlightColor: '#ffe04d' })
    await window.__icepdf.actions.highlightSelection()
  })
  await win.waitForTimeout(500)
  const annInfo = await win.evaluate(() => window.icepdf.engine('listAnnots', { page: 0 }))
  const annBefore = annInfo.length
  report('#A 형광펜이 Square(각진) 주석', annInfo.length > 0 && annInfo.every((a) => a.type === 'Square'), `type=${annInfo[0]?.type}`)
  // 형광펜 중앙 좌표를 구해 지우개로 클릭
  const erased = await win.evaluate(async () => {
    const anns = await window.icepdf.engine('listAnnots', { page: 0 })
    if (!anns.length) return { ok: false }
    const r = anns[0].rect
    const cx = (r[0] + r[2]) / 2
    const cy = (r[1] + r[3]) / 2
    const ok = await window.__icepdf.actions.eraseAt(0, cx, cy)
    const after = await window.icepdf.engine('listAnnots', { page: 0 })
    return { ok, after: after.length }
  })
  report('#7 지우개로 형광펜 삭제', annBefore >= 1 && erased.ok && erased.after === annBefore - 1, `${annBefore} → ${erased.after}`)

  // #8/#9 이미지 삽입(비율) + 회전(90°→가로세로 교환)
  const xform = await win.evaluate(async () => {
    // 120x60 캔버스 PNG 생성 → pendingImage로 설정
    const cv = document.createElement('canvas')
    cv.width = 120
    cv.height = 60
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#e23'
    ctx.fillRect(0, 0, 120, 60)
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
    const data = await blob.arrayBuffer()
    const s = window.__icepdf.state()
    s.set({ pendingImage: { path: '', data, naturalW: 120, naturalH: 60 } })
    await window.__icepdf.actions.placeImage(0, [100, 100, 300, 200])
    const r0 = window.__icepdf.state().selectedImage?.rect
    await window.__icepdf.actions.rotateImageBy(90)
    const r1 = window.__icepdf.state().selectedImage?.rect
    return { r0, r1 }
  })
  const w0 = xform.r0 ? xform.r0[2] - xform.r0[0] : 0
  const h0 = xform.r0 ? xform.r0[3] - xform.r0[1] : 0
  const w1 = xform.r1 ? xform.r1[2] - xform.r1[0] : 0
  const h1 = xform.r1 ? xform.r1[3] - xform.r1[1] : 0
  report('#8/#9 이미지 삽입 + 90° 회전(가로세로 교환)', Math.abs(w0 - h1) < 1 && Math.abs(h0 - w1) < 1, `${w0}x${h0} → ${w1}x${h1}`)

  // #5 그리드 Ctrl+휠 확대
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'grid' }))
  await win.waitForSelector('.grid-tile img', { timeout: 10000 })
  await win.waitForTimeout(400)
  const gw1 = await win.evaluate(() => document.querySelector('.grid-tile img')?.clientWidth ?? 0)
  await win.evaluate(() => {
    const el = document.querySelector('.grid-body')
    for (let i = 0; i < 3; i++)
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await win.waitForTimeout(400)
  const gw2 = await win.evaluate(() => document.querySelector('.grid-tile img')?.clientWidth ?? 0)
  report('#5 그리드 Ctrl+휠 확대', gw2 > gw1 + 10, `${gw1}px → ${gw2}px`)
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'scroll' }))

  await win.screenshot({ path: path.join(outDir, 'v2-magazine.png') })
} finally {
  await app.close()
}

console.log(results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
