/**
 * v1.3.0 검증: 텍스트 추가 툴 + 창 닫기 저장 확인.
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

const app = await electron.launch({ args: ['.', sample], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.page-canvas', { timeout: 20000 })

  // 메인의 close 다이얼로그를 패치해 호출을 기록 (네이티브 모달 자동 처리)
  await app.evaluate(({ dialog }) => {
    globalThis.__msgCalls = []
    globalThis.__msgResponse = 2 // 기본 '취소'
    dialog.showMessageBox = async (_win, opts) => {
      globalThis.__msgCalls.push(opts.message)
      return { response: globalThis.__msgResponse }
    }
  })

  // ── 1. 텍스트 추가 툴 ──
  const before = await win.evaluate(() =>
    window.icepdf.engine(window.__icepdf.state().activeDocId, 'listAnnots', { page: 0 }))
  await win.evaluate(() =>
    window.__icepdf.actions.placeText(0, 120, 140, '테스트 한글 Text 123', {
      font: 'Malgun Gothic',
      size: 22,
      color: '#d11a1a'
    })
  )
  await sleep(600)
  const after = await win.evaluate(() =>
    window.icepdf.engine(window.__icepdf.state().activeDocId, 'listAnnots', { page: 0 })
  )
  const sel = await win.evaluate(() => window.__icepdf.state().selectedImage)
  const dirty = await win.evaluate(() => window.__icepdf.state().dirty)
  const stampAdded = after.filter((a) => a.type === 'Stamp').length > before.filter((a) => a.type === 'Stamp').length
  report('텍스트 → Stamp 주석 추가', stampAdded, `annots ${before.length}→${after.length}`)
  report('텍스트 배치 후 선택 상태', !!sel && sel.page === 0, `rect=${sel?.rect?.map((n) => Math.round(n)).join(',')}`)
  report('텍스트 추가 후 dirty=true', dirty === true)

  // ── 2. 창 닫기 저장 확인 ──
  // dirty 상태가 메인에 동기화될 시간을 준다
  await sleep(400)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await sleep(400)
  const calls1 = await app.evaluate(() => globalThis.__msgCalls.slice())
  const stillOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  report('dirty 상태에서 닫기 시 확인 다이얼로그 표시', calls1.length === 1 && calls1[0].includes('저장하지 않은'))
  report("'취소' 선택 시 창 유지", stillOpen === 1)

  // '저장 안 함' 선택 → 실제로 닫힘 (마지막 창이 닫히면 앱도 종료되므로 컨텍스트 소멸 = 성공)
  await app.evaluate(() => {
    globalThis.__msgResponse = 1
  })
  let closed = false
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await sleep(600)
    const c = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    closed = c === 0
  } catch {
    closed = true // 컨텍스트/앱이 닫힘 = 창이 닫히고 앱 종료됨
  }
  report("'저장 안 함' 선택 시 창 닫힘", closed)
} catch (err) {
  report('예외 발생', false, String(err))
} finally {
  await app.close().catch(() => {})
}

console.log(failed ? `\n${failed}건 실패` : '\n전체 통과')
process.exit(failed ? 1 : 0)
