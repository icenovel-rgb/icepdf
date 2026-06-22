/** 인쇄 미리보기 UI 통합: 모달 표시 → 미리보기 렌더 → 모아찍기 전환 → 범위 지정 */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')

let fail = 0
const report = (n, ok, d = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({ args: ['.', sample], cwd: root })
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()) })
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('.page-canvas', { timeout: 20000 })

const pageCount = await win.evaluate(() => window.__icepdf.state().info.pageCount)
report('문서 열림', pageCount > 0, `${pageCount}쪽`)

// 인쇄 모달 열기 (메뉴 'print' / Ctrl+P → showPrint 와 동일 경로)
await win.evaluate(() => window.__icepdf.state().set({ showPrint: true }))
await win.waitForSelector('.print-modal', { timeout: 5000 })
report('인쇄 모달 표시', true)

// 미리보기 렌더 완료 — perSheet=1 → 시트 == 셀 == 페이지수, 이미지는 PNG data URL
await win.waitForSelector('.print-sheet', { timeout: 30000 })
await sleep(400)
const c1 = await win.evaluate(() => ({
  sheets: document.querySelectorAll('.print-sheet').length,
  cells: document.querySelectorAll('.print-cell').length,
  imgs: [...document.querySelectorAll('.print-cell img')].filter((i) => (i.getAttribute('src') || '').startsWith('data:image/png')).length
}))
report('1쪽/장 미리보기: 시트=셀=페이지수', c1.sheets === pageCount && c1.cells === pageCount, JSON.stringify(c1))
report('미리보기 이미지 = PNG data URL', c1.imgs === pageCount, `${c1.imgs}/${pageCount}`)

// 1쪽은 모아찍기와 분리 — 용지 방향이 페이지 자동(선택 비활성) + 시트에 여백(padding) 없음
const single = await win.evaluate(() => {
  const sh = document.querySelector('.print-sheet')
  return {
    orientDisabled: document.querySelector('.print-orient').disabled,
    isSingle: sh.classList.contains('single'),
    pad: getComputedStyle(sh).paddingLeft
  }
})
report('1쪽: 용지 방향 자동(선택 비활성)', single.orientDisabled, JSON.stringify(single))
report('1쪽: 시트 여백 없음(꽉 채움)', single.isSingle && single.pad === '0px', `pad=${single.pad}`)

// 모아찍기 4쪽 → 시트 = ceil(쪽/4), 셀 유지 (재렌더 없이 레이아웃만)
await win.locator('.print-nup').selectOption('4')
await sleep(300)
const c4 = await win.evaluate(() => ({
  sheets: document.querySelectorAll('.print-sheet').length,
  cells: document.querySelectorAll('.print-cell').length,
  cols: getComputedStyle(document.querySelector('.print-sheet')).gridTemplateColumns.split(' ').length,
  orientEnabled: !document.querySelector('.print-orient').disabled
}))
const expSheets = Math.ceil(pageCount / 4)
report('4쪽/장: 시트 = ceil(쪽/4)', c4.sheets === expSheets, `시트 ${c4.sheets} 기대 ${expSheets}`)
report('4쪽/장: 셀 수 유지', c4.cells === pageCount, `${c4.cells}`)
report('4쪽/장(세로): 그리드 2열', c4.cols === 2, `cols=${c4.cols}`)
report('모아찍기: 용지 방향 선택 활성', c4.orientEnabled)

// 모아찍기 2쪽 + 가로 용지 → 좌우 배치(2열), 시트 가로형(폭>높이)
await win.locator('.print-nup').selectOption('2')
await win.locator('.print-orient').selectOption('landscape')
await sleep(300)
const cL = await win.evaluate(() => {
  const sh = document.querySelector('.print-sheet')
  const cs = getComputedStyle(sh)
  const r = sh.getBoundingClientRect()
  return {
    cols: cs.gridTemplateColumns.split(' ').length,
    rows: cs.gridTemplateRows.split(' ').length,
    landscape: r.width > r.height
  }
})
report('가로 2쪽: 그리드 2열(좌우)', cL.cols === 2 && cL.rows === 1, `${cL.rows}x${cL.cols}`)
report('가로 용지: 시트 가로형(폭>높이)', cL.landscape, JSON.stringify(cL))

// 다시 세로로 되돌리고 4쪽
await win.locator('.print-orient').selectOption('portrait')
await win.locator('.print-nup').selectOption('4')
await sleep(200)

// 페이지 범위 "1" → 미리보기 갱신 → 셀 1개
await win.locator('.print-range').fill('1')
await win.locator('.print-apply').click()
await win.waitForFunction(() => document.querySelectorAll('.print-cell').length === 1, { timeout: 15000 }).catch(() => {})
const cr = await win.evaluate(() => document.querySelectorAll('.print-cell').length)
report('범위 "1" → 셀 1개', cr === 1, `${cr}`)

// 취소로 닫기
await win.locator('.print-cancel').click()
await sleep(200)
const closed = await win.evaluate(() => !document.querySelector('.print-modal'))
report('취소 → 모달 닫힘', closed)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
// 닫기 시 '저장 안 함'으로 응답해 추적 자산(sample.pdf) 오염 방지
await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) }).catch(() => {})
await app.close().catch(() => {})
process.exit(fail ? 1 : 0)
