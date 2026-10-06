/**
 * 새 버전 알림 UI 통합 — 로컬 가짜 GitHub 서버(ICEPDF_UPDATE_URL)로:
 * 실행 시 자동 확인 → 알림 카드 → "다운로드"(릴리스 페이지 열기) / 메뉴 "업데이트 확인"의 최신·실패·릴리스 없음 안내.
 */
import { _electron as electron } from 'playwright-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.pdf')
const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const NEW_URL = 'https://github.com/icenovel-rgb/icepdf/releases/tag/v99.0.0'

let fail = 0
const report = (n, ok, d = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); if (!ok) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 가짜 GitHub /releases/latest ──
let mode = 'newer'
let requests = 0
const server = http.createServer((_req, res) => {
  requests++
  if (mode === 'error') return void res.writeHead(500).end('boom')
  if (mode === 'missing') return void res.writeHead(404).end('{"message":"Not Found"}')
  const tag = mode === 'newer' ? 'v99.0.0' : `v${current}`
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ tag_name: tag, html_url: `https://github.com/icenovel-rgb/icepdf/releases/tag/${tag}`, draft: false, prerelease: false }))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/latest`

const exe = process.env.ICEPDF_EXE
const env = { ...process.env, ICEPDF_UPDATE_URL: url }
const app = await electron.launch(exe ? { executablePath: exe, args: [sample], env } : { args: ['.', sample], cwd: root, env })
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text()) })
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('.page-canvas', { timeout: 20000 })

// 외부 링크 열기를 가로채 기록 (실제 브라우저를 띄우지 않음) + 닫기 대화상자는 '저장 안 함'
await app.evaluate(({ shell, dialog }) => {
  globalThis.__opened = []
  shell.openExternal = async (u) => { globalThis.__opened.push(u) }
  dialog.showMessageBox = async () => ({ response: 1 })
})

// ── 실행 직후 자동 확인 → 알림 카드 ──
await win.waitForSelector('.update-banner', { timeout: 15000 }).catch(() => {})
const b = await win.evaluate(() => ({
  shown: !!document.querySelector('.update-banner'),
  text: document.querySelector('.update-banner')?.textContent ?? ''
}))
report('실행 시 자동 확인 → 새 버전 알림 카드', b.shown && b.text.includes('v99.0.0'), b.text)
report('알림에 현재 버전 표시', b.text.includes(`v${current}`), `현재 v${current}`)
report('자동 확인은 한 번만 요청', requests === 1, `${requests}회`)

// ── "다운로드" → 이 저장소 릴리스 페이지를 연다 + 카드 닫힘 ──
await win.locator('.update-download').click()
await sleep(300)
const opened = await app.evaluate(() => globalThis.__opened)
report('다운로드 → 릴리스 페이지 열기', opened.length === 1 && opened[0] === NEW_URL, JSON.stringify(opened))
report('다운로드 후 카드 닫힘', !(await win.evaluate(() => !!document.querySelector('.update-banner'))))

// ── 메뉴 "업데이트 확인..." (실제 메뉴 항목 클릭) ──
const clickMenu = () => app.evaluate(({ Menu, BrowserWindow }) => {
  const find = (items) => {
    for (const it of items) {
      if (it.label === '업데이트 확인...') return it
      const sub = it.submenu ? find(it.submenu.items) : null
      if (sub) return sub
    }
    return null
  }
  const item = find(Menu.getApplicationMenu().items)
  item.click(undefined, BrowserWindow.getAllWindows()[0])
  return !!item
})
const toastAfter = async () => {
  await win.evaluate(() => window.__icepdf.state().set({ toast: null }))
  await clickMenu()
  await win.waitForFunction(() => !!window.__icepdf.state().toast, null, { timeout: 10000 }).catch(() => {})
  return win.evaluate(() => window.__icepdf.state().toast ?? '')
}

mode = 'same'
const t1 = await toastAfter()
report('수동 확인: 최신이면 안내', t1.includes('최신 버전') && t1.includes(`v${current}`), t1)
mode = 'missing'
const t2 = await toastAfter()
report('수동 확인: 릴리스 없음(404) → 최신으로 안내', t2.includes('최신 버전'), t2)
mode = 'error'
const t3 = await toastAfter()
report('수동 확인: 서버 오류 → 실패 안내', t3.includes('업데이트 확인 실패') && t3.includes('500'), t3)

mode = 'newer'
await clickMenu()
await win.waitForSelector('.update-banner', { timeout: 10000 }).catch(() => {})
report('수동 확인: 새 버전 → 알림 카드', await win.evaluate(() => !!document.querySelector('.update-banner')))
await win.locator('.update-later').click()
await sleep(200)
report('"나중에" → 카드 닫힘(링크 안 엶)', !(await win.evaluate(() => !!document.querySelector('.update-banner'))) && (await app.evaluate(() => globalThis.__opened.length)) === 1)

// ── 정보 창에 현재 버전 ──
await win.evaluate(() => window.__icepdf.state().set({ showSupport: true }))
await sleep(200)
const ver = await win.evaluate(() => document.querySelector('.support-ver')?.textContent ?? '')
report('정보 창에 현재 버전 표시', ver === `v${current}`, ver)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
await app.close().catch(() => {})
server.close()
process.exit(fail ? 1 : 0)
