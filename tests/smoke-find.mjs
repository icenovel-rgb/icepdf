/** 찾기(Ctrl+F) UI 통합 — 실제 키 입력으로: 열기 → 입력 → 결과·강조 → Enter/Shift+Enter/F3 → 결과 위치 스크롤 → Esc */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')

let fail = 0
const report = (n, ok, d = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ICEPDF_EXE=release/win-unpacked/ICEPDF.exe 로 주면 패키징된 앱(설치본과 동일 구성)을 검증
const exe = process.env.ICEPDF_EXE
const app = await electron.launch(exe ? { executablePath: exe, args: [sample] } : { args: ['.', sample], cwd: root })
if (exe) console.log(`패키징 앱 검증: ${exe}`)
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()) })
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('.page-canvas', { timeout: 20000 })

const st = (fn) => win.evaluate(fn)
// 엇나간 Delete가 쪽 삭제 확인창(네이티브)을 띄워도 멈추지 않게 '취소'로 응답 + 기록
await app.evaluate(({ dialog }) => {
  globalThis.__dialogs = []
  dialog.showMessageBox = async (_w, o) => { globalThis.__dialogs.push((o ?? _w)?.message); return { response: 1 } }
})
const waitDone = () => win.waitForFunction(() => window.__icepdf.state().findStatus === 'done', null, { timeout: 15000 })
const pageCount = await st(() => window.__icepdf.state().info.pageCount)

// 기대값: 엔진에 전체 쪽을 한 번에 물어본 결과
const expected = await win.evaluate(async (n) => {
  const s = window.__icepdf.state()
  const r = await window.icepdf.engine(s.activeDocId, 'search', { needle: 'fox', from: 0, to: n, maxHits: 99999 })
  return r.hits.map((h) => h.page)
}, pageCount)
report('샘플에 fox 결과 여러 개', expected.length >= 2, `${expected.length}건 / 쪽 ${expected.join(',')}`)

// ── Ctrl+F → 막대 표시 + 입력칸 포커스 ──
await win.locator('.viewer').click({ position: { x: 5, y: 5 } })
await win.keyboard.press('Control+f')
await win.waitForSelector('.find-bar', { timeout: 3000 }).catch(() => {})
await sleep(100)
const focused = await st(() => document.activeElement?.classList.contains('find-input') ?? false)
report('Ctrl+F → 찾기 막대 + 입력칸 포커스', focused)

// ── 입력(실제 타이핑) → 구간 검색 결과 = 엔진 전체 결과 ──
await win.keyboard.type('fox')
await sleep(300)
await waitDone()
const r1 = await st(() => {
  const s = window.__icepdf.state()
  return { n: s.findHits.length, idx: s.findIndex, page: s.currentPage, pages: s.findHits.map((h) => h.page), count: document.querySelector('.find-count')?.textContent }
})
report('결과 수 = 엔진 전체 검색', r1.n === expected.length, `${r1.n}/${expected.length}`)
report('결과 쪽 순서 동일', JSON.stringify(r1.pages) === JSON.stringify(expected))
report('첫 결과 선택 + 상태 문구', r1.idx === 0 && r1.count === `1 / ${expected.length}`, `${r1.count}`)
report('첫 결과 쪽으로 이동', r1.page === expected[0], `현재 ${r1.page + 1}쪽`)

const marks = await st(() => ({ all: document.querySelectorAll('.find-hit').length, cur: document.querySelectorAll('.find-hit.current').length }))
report('결과 강조 표시 (현재 결과 1개 강조)', marks.all >= 1 && marks.cur >= 1, JSON.stringify(marks))

// 현재 결과 강조 박스가 뷰어 화면 안에 보이는지
const inView = () => st(() => {
  const el = document.querySelector('.find-hit.current')
  const v = document.querySelector('.viewer')
  if (!el || !v) return false
  const a = el.getBoundingClientRect()
  const b = v.getBoundingClientRect()
  return a.top >= b.top && a.bottom <= b.bottom
})

// ── Enter → 다음 결과, 그 위치로 스크롤 ──
await win.keyboard.press('Enter')
await sleep(400)
const r2 = await st(() => ({ idx: window.__icepdf.state().findIndex, page: window.__icepdf.state().currentPage }))
report('Enter → 다음 결과', r2.idx === 1, `idx=${r2.idx}`)
report('다음 결과 쪽으로 이동', r2.page === expected[1], `현재 ${r2.page + 1}쪽, 기대 ${expected[1] + 1}쪽`)
report('현재 결과가 화면 안에 보임', await inView())

// ── Shift+Enter → 이전, F3 → 다음 ──
await win.keyboard.press('Shift+Enter')
await sleep(300)
report('Shift+Enter → 이전 결과', (await st(() => window.__icepdf.state().findIndex)) === 0)
await win.keyboard.press('F3')
await sleep(300)
report('F3 → 다음 결과', (await st(() => window.__icepdf.state().findIndex)) === 1)

// ── 끝에서 Enter → 처음으로 순환 ──
for (let i = 1; i < expected.length; i++) await win.keyboard.press('Enter')
await sleep(400)
report('마지막 다음 → 처음으로 순환', (await st(() => window.__icepdf.state().findIndex)) === 0)

// ── 입력 중 Delete/Space가 전역 단축키(쪽 삭제·손도구)를 건드리지 않음 ──
const focusNow = await st(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)
report('결과 이동 후에도 입력칸 포커스 유지', focusNow === 'INPUT.find-input', focusNow)
await win.keyboard.press('Control+a')
await win.keyboard.press('Delete')
await win.keyboard.type('quick brown')
await sleep(300)
await waitDone()
const r3 = await st(() => {
  const s = window.__icepdf.state()
  return { pages: s.info.pageCount, pan: s.panMode, q: s.findQuery, n: s.findHits.length }
})
const dialogs = await app.evaluate(() => globalThis.__dialogs)
report('입력칸 Delete → 쪽 삭제 안 됨 (확인창도 안 뜸)', r3.pages === pageCount && dialogs.length === 0, `${r3.pages}쪽, 대화상자 ${JSON.stringify(dialogs)}`)
report('입력칸 Space → 손도구 안 켜짐', r3.pan === false)
report('공백 포함 검색어 결과', r3.q === 'quick brown' && r3.n >= 1, `${r3.q} → ${r3.n}건`)

// ── 결과 없음 ──
await win.keyboard.press('Control+a')
await win.keyboard.type('zzqqxx')
await sleep(300)
await waitDone()
const r4 = await st(() => ({ n: window.__icepdf.state().findHits.length, count: document.querySelector('.find-count')?.textContent, none: !!document.querySelector('.find-input.find-none') }))
report('결과 없음 표시', r4.n === 0 && r4.count === '결과 없음' && r4.none, JSON.stringify(r4))

// ── Esc → 닫기 + 강조 제거, 다시 Ctrl+F → 검색어 유지 ──
await win.keyboard.press('Escape')
await sleep(200)
const r5 = await st(() => ({ bar: !!document.querySelector('.find-bar'), marks: document.querySelectorAll('.find-hit').length }))
report('Esc → 막대 닫힘 + 강조 제거', !r5.bar && r5.marks === 0, JSON.stringify(r5))
await win.keyboard.press('Control+f')
await sleep(200)
const kept = await st(() => document.querySelector('.find-input')?.value)
report('다시 열면 검색어 유지', kept === 'zzqqxx', `${kept}`)

// ── 선택한 한 줄 텍스트로 검색어 미리 채우기 ──
await win.keyboard.press('Escape')
await st(() => window.__icepdf.state().set({ selection: { page: 0, quads: [], text: 'lazy dog' } }))
await win.keyboard.press('Control+f')
await sleep(300)
await waitDone()
const r6 = await st(() => ({ q: document.querySelector('.find-input')?.value, n: window.__icepdf.state().findHits.length }))
report('선택 텍스트 → 검색어 프리필 + 검색', r6.q === 'lazy dog' && r6.n >= 1, JSON.stringify(r6))

// ── 인쇄 모달이 떠 있으면 Ctrl+F·F3 무시 (뒤에서 찾기 막대가 포커스를 가져가지 않음) ──
await win.keyboard.press('Escape')
await sleep(200)
await win.locator('button[title^="인쇄"]').click()
await win.waitForSelector('.print-modal', { timeout: 5000 })
await win.keyboard.press('Control+f')
await win.keyboard.press('F3')
await sleep(300)
const r7 = await st(() => ({ bar: !!document.querySelector('.find-bar'), open: window.__icepdf.state().findOpen, modal: !!document.querySelector('.print-modal') }))
report('인쇄 모달 위 Ctrl+F·F3 → 찾기 막대 안 열림', !r7.bar && !r7.open && r7.modal, JSON.stringify(r7))
await win.locator('.print-cancel').click()
await sleep(200)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
// 닫기 시 '저장 안 함'으로 응답해 추적 자산(sample.pdf) 오염 방지
await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) }).catch(() => {})
await app.close().catch(() => {})
process.exit(fail ? 1 : 0)
