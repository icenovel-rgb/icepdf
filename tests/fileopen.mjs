/**
 * #1 검증: 앱을 PDF 경로 인자와 함께 실행하면(=연결 프로그램으로 열기) 자동으로 그 PDF가 열린다.
 * 사전: npm run build
 */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const magazine = path.join(root, 'samples', 'magazine.pdf')

let failed = 0
const report = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

// 인자에 PDF 경로를 넣어 실행 (Windows '연결 프로그램으로 열기'와 동일)
const app = await electron.launch({ args: ['.', magazine], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // 사용자가 아무 조작도 하지 않아도 문서가 열려야 한다
  await win.waitForSelector('.page-view img', { timeout: 20000 })
  const info = await win.evaluate(() => window.__icepdf.state().info)
  report('#1 인자 PDF 자동 열기', !!info && info.pageCount > 1, `title=${info?.title}, pages=${info?.pageCount}`)
} finally {
  await app.close()
}

process.exit(failed ? 1 : 0)
