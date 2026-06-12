/**
 * ICEPDF 스모크 e2e — 빌드된 앱을 Playwright로 구동해 전 기능을 증거 기반 검증.
 * 사전 조건: npm run build && node spike/make-sample.mjs
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'spike', 'output')
fs.mkdirSync(outDir, { recursive: true })
const samplePath = path.join(root, 'samples', 'sample.pdf')
const savedPath = path.join(outDir, 'edited.pdf')
const mdPath = path.join(outDir, 'export.md')
const hwpxPath = path.join(outDir, 'export.hwpx')
for (const f of [savedPath, mdPath, hwpxPath]) if (fs.existsSync(f)) fs.unlinkSync(f)

const results = []
let failed = 0
function report(name, ok, detail = '') {
  results.push(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

const app = await electron.launch({ args: ['.'], cwd: root })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // 네이티브 다이얼로그 자동 응답 패치 (테스트 전용)
  await app.evaluate(({ dialog }, paths) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    dialog.showSaveDialog = async (_w, opts) => {
      const ext = opts?.filters?.[0]?.extensions?.[0] ?? 'pdf'
      const map = { pdf: paths.savedPath, md: paths.mdPath, hwpx: paths.hwpxPath }
      return { canceled: false, filePath: map[ext] }
    }
  }, { savedPath, mdPath, hwpxPath })

  // 1. 문서 열기
  await win.evaluate((p) => window.__icepdf.actions.openFile(p), samplePath)
  await win.waitForSelector('.page-view img', { timeout: 15000 })
  const pageCount = await win.evaluate(() => window.__icepdf.state().info?.pageCount)
  report('1. 문서 열기 + 페이지 렌더', pageCount === 6, `pageCount=${pageCount}`)
  await win.screenshot({ path: path.join(outDir, '01-open.png') })

  // 2. 텍스트 선택 (엔진 경유)
  const sel = await win.evaluate(() =>
    window.icepdf.engine('selection', { page: 0, ax: 70, ay: 70, bx: 520, by: 130 })
  )
  report('2. 텍스트 선택', sel.text.includes('ICEPDF') && sel.quads.length > 0, `"${sel.text.slice(0, 50).trim()}..." quads=${sel.quads.length}`)

  // 3. 마우스 드래그 선택 (UI 경유)
  const img = win.locator('.page-view img').first()
  const box = await img.boundingBox()
  await win.mouse.move(box.x + 60, box.y + 95)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width - 80, box.y + 115, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(300)
  const dragSel = await win.evaluate(() => window.__icepdf.state().selection)
  report('3. 마우스 드래그 선택 UI', !!dragSel && dragSel.text.length > 0, `"${(dragSel?.text ?? '').slice(0, 40).trim()}"`)
  await win.screenshot({ path: path.join(outDir, '02-selection.png') })

  // 4. 형광펜
  await win.evaluate(() => {
    window.__icepdf.state().set({ tool: 'highlight' })
    return window.__icepdf.actions.highlightSelection()
  })
  await win.waitForTimeout(500)
  const annots = await win.evaluate(() => window.icepdf.engine('listAnnots', { page: 0 }))
  report('4. 형광펜 주석 생성(각진 Square)', annots.length >= 1 && annots.every((a) => a.type === 'Square'), JSON.stringify(annots))
  await win.screenshot({ path: path.join(outDir, '03-highlight.png') })

  // 5. 책갈피 추가 (Ctrl+B 핸들러와 동일 액션)
  await win.evaluate(() => window.__icepdf.actions.addBookmarkAtCurrentPage())
  await win.waitForTimeout(300)
  const outline = await win.evaluate(() => window.__icepdf.state().info?.outline)
  report('5. 책갈피 추가', outline?.length === 1 && outline[0].page === 0, JSON.stringify(outline))

  // 6. 빈 페이지 삽입 + 페이지 삭제
  await win.evaluate(() => window.__icepdf.actions.insertBlankAt(1))
  await win.waitForTimeout(300)
  const afterInsert = await win.evaluate(() => window.__icepdf.state().info?.pageCount)
  await win.evaluate(() => window.__icepdf.actions.deletePageAt(6))
  await win.waitForTimeout(300)
  const afterDelete = await win.evaluate(() => window.__icepdf.state().info?.pageCount)
  report('6. 페이지 삽입/삭제', afterInsert === 7 && afterDelete === 6, `insert→${afterInsert}, delete→${afterDelete}`)

  // 7. 다른 PDF에서 페이지 삽입 (open 다이얼로그 패치)
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, samplePath)
  await win.evaluate(() => window.__icepdf.actions.insertFromPdfAt(6))
  await win.waitForTimeout(800)
  const afterGraft = await win.evaluate(() => window.__icepdf.state().info?.pageCount)
  report('7. 다른 PDF에서 삽입', afterGraft === 12, `pageCount=${afterGraft}`)

  // 8. 이미지 삽입 (1x1 PNG)
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  await win.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    await window.icepdf.engine('addImage', { page: 1, rect: [100, 100, 300, 250], png: arr.buffer })
    window.__icepdf.state().applyEdit(await window.icepdf.engine('docInfo', {}))
  }, pngB64)
  const imgAnnots = await win.evaluate(() => window.icepdf.engine('listAnnots', { page: 1 }))
  report('8. 이미지 삽입(Stamp)', imgAnnots.some((a) => a.type === 'Stamp'), JSON.stringify(imgAnnots))

  // 9. 그리드 보기 전환
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'grid' }))
  await win.waitForSelector('.grid-tile img', { timeout: 10000 })
  const tiles = await win.locator('.grid-tile').count()
  report('9. 그리드 보기', tiles === 12, `tiles=${tiles}`)
  await win.screenshot({ path: path.join(outDir, '04-grid.png') })
  await win.evaluate(() => window.__icepdf.state().set({ viewMode: 'scroll' }))

  // 10. 저장
  await win.evaluate(() => window.__icepdf.actions.saveFile(true))
  await win.waitForTimeout(1200)
  report('10. PDF 저장', fs.existsSync(savedPath), savedPath)

  // 11. Markdown 내보내기
  await win.evaluate(() => window.__icepdf.actions.exportDoc('markdown'))
  await win.waitForFunction(() => window.__icepdf.state().busy === null)
  await win.waitForTimeout(500)
  const mdOk = fs.existsSync(mdPath) && fs.readFileSync(mdPath, 'utf-8').length > 50
  report('11. Markdown 내보내기', mdOk, mdOk ? `${fs.statSync(mdPath).size} bytes` : '파일 없음')

  // 12. HWPX 내보내기
  await win.evaluate(() => window.__icepdf.actions.exportDoc('hwpx'))
  await win.waitForFunction(() => window.__icepdf.state().busy === null, { timeout: 60000 })
  await win.waitForTimeout(500)
  const hwpxOk = fs.existsSync(hwpxPath) && fs.readFileSync(hwpxPath).subarray(0, 2).toString() === 'PK'
  report('12. HWPX 내보내기 (zip 시그니처)', hwpxOk, hwpxOk ? `${fs.statSync(hwpxPath).size} bytes` : '파일 없음')
} finally {
  await app.close()
}

// 13. 저장 파일 무결성 재검증 (mupdf 재열기)
{
  const mupdf = await import('mupdf')
  const re = mupdf.Document.openDocument(fs.readFileSync(savedPath), 'application/pdf')
  const ok = re.countPages() === 12 && (re.loadOutline()?.length ?? 0) === 1
  const annotCount = re.loadPage(0).getAnnotations().length
  report('13. 저장 파일 재검증', ok && annotCount === 1, `pages=${re.countPages()}, outline=${re.loadOutline()?.length}, annots(p1)=${annotCount}`)
}

console.log(results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
