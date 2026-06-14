/** 텍스트 편집 UI 전체 경로: 툴바 크기/폰트/색상 + 코너 핸들 드래그(비례) */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')

let fail = 0
const report = (n, ok, d = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sel = (win) => win.evaluate(() => { const s = window.__icepdf.state().selectedImage; return s ? { index: s.index, size: s.text?.size, font: s.text?.font, color: s.text?.color, w0: +s.w0.toFixed(2), h0: +s.h0.toFixed(2), nW: s.naturalW, nH: s.naturalH, rect: s.rect.map((n) => Math.round(n)) } : null })
/** 비동기 재렌더 완료까지 폴링 — 고정 sleep로는 size-76 같은 큰 렌더가 늦게 끝나 놓친다 */
const waitSel = async (win, pred, ms = 4000) => {
  const t0 = Date.now()
  for (;;) {
    const s = await sel(win)
    if (pred(s) || Date.now() - t0 > ms) return s
    await sleep(120)
  }
}

const app = await electron.launch({ args: ['.', sample], cwd: root })
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()) })
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('.page-canvas', { timeout: 20000 })

// 텍스트 배치 (UI)
await win.evaluate(() => window.__icepdf.state().set({ tool: 'text' }))
await win.locator('.page-view').first().click({ position: { x: 90, y: 90 } })
await sleep(300)
await win.locator('.text-draft').fill('비례 Test')
await win.locator('.page-view').first().click({ position: { x: 330, y: 330 } })
await sleep(700)
const s0 = await sel(win)
report('텍스트 배치 + 선택', !!s0?.size, JSON.stringify(s0))
const aspect0 = s0.w0 / s0.h0

// 1) 툴바 크기 입력
await win.locator('.tb-fontsize').fill('44')
const s1 = await waitSel(win, (s) => s?.size === 44)
report('툴바 크기 변경 → text.size=44', s1?.size === 44, `size=${s1?.size}`)

// 2) 툴바 폰트 드롭다운
await win.locator('.tb-font').selectOption('Batang')
const s2 = await waitSel(win, (s) => s?.font === 'Batang')
report('툴바 폰트 변경 → Batang', s2?.font === 'Batang', `font=${s2?.font}`)

// 3) 툴바 색상 — React 호환 네이티브 value setter로 설정
await win.evaluate(() => {
  const el = document.querySelector('.tb-fontcolor')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, '#00aa00')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const s3 = await waitSel(win, (s) => (s?.color || '').toLowerCase() === '#00aa00')
report('툴바 색상 변경 → #00aa00', (s3?.color || '').toLowerCase() === '#00aa00', `color=${s3?.color}`)

// 4) 코너 핸들 드래그 — 비례(왜곡 없음): 박스 종횡비 == 비트맵 종횡비, 폰트 크기 변함
const before = await sel(win)
/** se 코너를 (dx,dy)만큼 드래그 — 작은 폭으로 박스가 화면 안에 남도록 */
async function dragResize(dx, dy) {
  const h = await win.locator('.img-handle.se').boundingBox()
  await win.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await win.mouse.down(); await win.mouse.move(h.x + dx, h.y + dy, { steps: 12 }); await win.mouse.up()
}
/** 왜곡 없음 = 표시 박스 종횡비 == 비트맵 종횡비 && 직전 종횡비와 동일(비례) */
const noDistort = (b, a) => Math.abs(a.w0 / a.h0 - a.nW / a.nH) < 0.02 && Math.abs(a.w0 / a.h0 - b.w0 / b.h0) < 0.06

// 같은 텍스트에 작은 드래그 3종(가로 키움 · 세로 키움 · 축소) — 매번 비례 유지 검증
const b1 = before
await dragResize(70, 24) // 가로 우세
const a1 = await waitSel(win, (s) => s?.size !== b1.size)
report('리사이즈(가로 드래그): 왜곡 0 + 비례', noDistort(b1, a1), `aspect ${(b1.w0 / b1.h0).toFixed(3)}→${(a1.w0 / a1.h0).toFixed(3)}, size ${b1.size}→${a1.size}`)

const b2 = await sel(win)
await dragResize(15, 55) // 세로 우세
const a2 = await waitSel(win, (s) => s?.size !== b2.size)
report('리사이즈(세로 드래그): 왜곡 0 + 비례', noDistort(b2, a2), `aspect ${(b2.w0 / b2.h0).toFixed(3)}→${(a2.w0 / a2.h0).toFixed(3)}, size ${b2.size}→${a2.size}`)

const b3 = await sel(win)
await dragResize(-50, -17) // 안쪽 → 축소
const a3 = await waitSel(win, (s) => s?.size !== b3.size)
report('리사이즈(축소): 왜곡 0 + 크기 감소', noDistort(b3, a3) && a3.size < b3.size, `aspect ${(b3.w0 / b3.h0).toFixed(3)}→${(a3.w0 / a3.h0).toFixed(3)}, size ${b3.size}→${a3.size}`)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
// 닫기 시 '저장 안 함'으로 응답해 추적 자산(sample.pdf) 저장 오염 방지
await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) }).catch(() => {})
await app.close().catch(() => {})
process.exit(fail ? 1 : 0)
