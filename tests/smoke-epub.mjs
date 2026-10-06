/**
 * EPUB UI 통합 — 연결 프로그램 인자로 열기 → 렌더·읽기 전용·목차·글자 크기(리플로우)·찾기
 * → 툴바 "PDF 변환" → 새 탭(편집 가능 PDF) → 탭 전환 시 찾기 재검색 → EPUB Markdown 내보내기.
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sample = path.join(root, 'samples', 'sample.epub')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icepdf-epub-'))
const pdfOut = path.join(tmp, '변환결과.pdf')
const mdOut = path.join(tmp, '내보내기.md')

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
const st = (fn, arg) => win.evaluate(fn, arg)
const info = () => st(() => window.__icepdf.state().info)

// ── 열기 (argv 경로) ──
const i0 = await info()
report('EPUB 열림 (연결 프로그램 인자)', i0?.kind === 'epub' && i0.title === 'sample.epub', `${i0?.kind} ${i0?.title}`)
report('여러 쪽 + 기본 글자 크기 14pt', i0.pageCount > 1 && i0.fontSize === 14, `${i0.pageCount}쪽 ${i0.fontSize}pt`)

// 첫 쪽 캔버스에 실제로 글자가 그려졌는지 (흰 바탕이 아닌 픽셀 비율)
await sleep(500)
const ink = await st(() => {
  const c = document.querySelector('.page-canvas')
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let dark = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++
  return dark / (d.length / 4)
})
report('본문 렌더(글자 픽셀 존재)', ink > 0.005, `${(ink * 100).toFixed(2)}%`)

// ── 읽기 전용 UI ──
const ro = await st(() => ({
  hl: document.querySelector('.tb-tool-highlight')?.disabled,
  badge: document.querySelector('.sb-epub')?.textContent ?? '',
  convert: !!document.querySelector('.tb-convert-pdf')
}))
report('편집 도구 비활성 (형광펜)', ro.hl === true)
report('상태바 EPUB 읽기 전용 배지', ro.badge.includes('읽기 전용'), ro.badge)
report('툴바 PDF 변환 버튼 표시', ro.convert)

// Delete 키 → 쪽 삭제 대신 안내 (pageCount 유지, dirty 아님)
await win.locator('.viewer').click({ position: { x: 5, y: 5 } })
await win.keyboard.press('Delete')
await sleep(300)
const del = await st(() => ({ n: window.__icepdf.state().info.pageCount, dirty: window.__icepdf.state().dirty, toast: window.__icepdf.state().toast ?? '' }))
report('Delete → 쪽 유지 + 읽기 전용 안내', del.n === i0.pageCount && !del.dirty && del.toast.includes('읽기 전용'), JSON.stringify(del))
await win.keyboard.press('Control+z')
await sleep(200)
report('Ctrl+Z → 변경 없음(dirty 아님)', (await st(() => window.__icepdf.state().dirty)) === false)

// ── 목차 (사이드바 "목차" 탭) ──
await win.locator('.sidebar-tabs button', { hasText: '목차' }).click()
await sleep(200)
const rows = await st(() => [...document.querySelectorAll('.bm-panel--toc .bm-row .bm-title')].map((e) => e.textContent))
report('목차 4항목(중첩 포함)', rows.length === 4, rows.join(' | '))
const ch3Page = i0.outline[2].page
await win.locator('.bm-panel--toc .bm-title', { hasText: '제3장' }).click()
await sleep(400)
report('목차 클릭 → 해당 쪽 이동', (await st(() => window.__icepdf.state().currentPage)) === ch3Page, `기대 ${ch3Page + 1}쪽`)

// ── 글자 크게(2단계 14→18pt) → 다시 쪽 나눔 + 읽던 위치 비율 유지 ──
// (이 샘플은 14pt·16pt가 우연히 둘 다 9쪽이라 18pt까지 올려 쪽수 변화를 확인)
const before = await st(() => ({ page: window.__icepdf.state().currentPage, n: window.__icepdf.state().info.pageCount }))
await win.locator('.tb-font-up').click()
await win.waitForFunction(() => window.__icepdf.state().info.fontSize === 16, null, { timeout: 10000 }).catch(() => {})
await win.locator('.tb-font-up').click()
await win.waitForFunction(() => window.__icepdf.state().info.fontSize === 18, null, { timeout: 10000 }).catch(() => {})
await sleep(300)
const after = await st(() => ({ page: window.__icepdf.state().currentPage, n: window.__icepdf.state().info.pageCount, fs: window.__icepdf.state().info.fontSize, label: document.querySelector('.tb-font-size')?.textContent }))
report('글자 크게 → 18pt + 쪽수 증가', after.fs === 18 && after.n > before.n && after.label === '18pt', `${before.n}→${after.n}쪽, ${after.label}`)
const expectPage = Math.floor((before.page * after.n) / before.n + 1e-9)
report('읽던 위치(비율) 유지', after.page === expectPage, `${before.page + 1}/${before.n} → ${after.page + 1}/${after.n} (기대 ${expectPage + 1})`)
report('리플로우 후 목차 쪽 재계산', (await info()).outline[2].page > ch3Page)

// ── 찾기 (한글) ──
await win.keyboard.press('Control+f')
await sleep(150)
await win.keyboard.type('펭귄')
await sleep(300)
await win.waitForFunction(() => window.__icepdf.state().findStatus === 'done', null, { timeout: 15000 })
const f1 = await st(() => ({ n: window.__icepdf.state().findHits.length, doc: window.__icepdf.state().findDocId }))
report('EPUB 한글 검색 결과', f1.n > 0, `${f1.n}건`)

// ── 툴바 PDF 변환 → 저장 경로 + "새 탭에서 열기" 확인 ──
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  dialog.showMessageBox = async () => ({ response: 0 })
}, pdfOut)
const epubPages = (await info()).pageCount
await win.locator('.tb-convert-pdf').click()
await win.waitForFunction(() => window.__icepdf.state().tabs.length === 2 && window.__icepdf.state().info?.kind === 'pdf', null, { timeout: 30000 }).catch(() => {})
const conv = await info()
report('변환 PDF 파일 생성', fs.existsSync(pdfOut), `${fs.existsSync(pdfOut) ? Math.round(fs.statSync(pdfOut).size / 1024) + 'KB' : '없음'}`)
report('변환 PDF 새 탭으로 열림(편집 가능 PDF)', conv?.kind === 'pdf' && conv.pageCount === epubPages, `${conv?.kind} ${conv?.pageCount}/${epubPages}쪽`)
report('변환 PDF 목차 보존', conv?.outline?.length === 3 && conv.outline[1].children.length === 1)
await sleep(200)
report('변환 PDF 탭: 편집 도구 활성', (await st(() => document.querySelector('.tb-tool-highlight')?.disabled)) === false)

// 찾기 막대가 열린 채 탭이 바뀌면 새 문서로 자동 재검색
await win.waitForFunction(() => {
  const s = window.__icepdf.state()
  return s.findDocId === s.activeDocId && s.findStatus === 'done'
}, null, { timeout: 15000 }).catch(() => {})
const f2 = await st(() => ({ same: window.__icepdf.state().findDocId === window.__icepdf.state().activeDocId, n: window.__icepdf.state().findHits.length }))
report('탭 전환 → 변환 PDF에서 자동 재검색(한글 검색 가능)', f2.same && f2.n === f1.n, `${f2.n}/${f1.n}건`)

// ── EPUB 탭에서 Markdown 내보내기 (EPUB→PDF→kordoc 경로) ──
await win.evaluate(() => {
  const s = window.__icepdf.state()
  s.switchTab(s.tabs[0].id)
})
await sleep(300)
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  dialog.showMessageBox = async () => ({ response: 0 })
}, mdOut)
await win.locator('.tb-btn.tb-text', { hasText: 'MD' }).click()
await win.waitForFunction(() => !window.__icepdf.state().busy, null, { timeout: 60000 }).catch(() => {})
await sleep(300)
const md = fs.existsSync(mdOut) ? fs.readFileSync(mdOut, 'utf8') : ''
report('EPUB → Markdown 내보내기 (한글 본문 포함)', md.includes('겨울의 시작') && md.includes('펭귄'), `${md.length}자`)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) }).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
