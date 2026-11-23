/**
 * v1.11 e2e (실제 클릭·키 입력) —
 * ① EPUB 읽기 글꼴: 툴바에서 고르면 두 EPUB 탭 모두 다시 나뉘고, PDF 변환에도 그 글꼴이 들어가며(다크 테마여도),
 *    재시작 후 복원, '책 기본 글꼴'로 되돌리면 원래 쪽 수
 * ② 쪽 번호 칸: 세 자리 쪽도 잘리지 않고, 비운 채 입력 → Enter로 이동(치는 도중엔 안 튐)·방향키
 * ③ 문장 카드: 배경 24개, 위쪽 따옴표 없음, 오른쪽·양쪽 정렬, 출처 정렬 따로 (캔버스 픽셀로 확인)
 * 실제 사용자 데이터를 건드리지 않게 임시 폴더를 ICEPDF_USER_DATA 로 넘겨 띄운다.
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const epub = path.join(root, 'samples', 'sample.epub')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icepdf-v111-'))
const userData = path.join(tmp, 'userdata')
const bigPdf = path.join(tmp, '120쪽.pdf')

let fail = 0
const report = (n, ok, d = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!ok) fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 120쪽짜리 빈 PDF (세 자리 쪽 번호 확인용)
{
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < 120; i++) doc.insertPage(-1, doc.addPage([0, 0, 300, 400], 0, doc.newDictionary(), ''))
  fs.writeFileSync(bigPdf, doc.saveToBuffer('').asUint8Array())
}

const exe = process.env.ICEPDF_EXE
async function launch(file) {
  const args = [file]
  const env = { ...process.env, ICEPDF_USER_DATA: userData }
  const app = await electron.launch(exe ? { executablePath: exe, args, env } : { args: ['.', ...args], cwd: root, env })
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') console.log('  [err]', m.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.page-canvas', { timeout: 20000 })
  return { app, win }
}
const state = (win) => win.evaluate(() => window.__icepdf.state())
async function waitFor(win, fn, arg, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await win.evaluate(fn, arg)) return true
    await sleep(100)
  }
  return false
}
/** 탭마다 화면 정보 쪽 수 vs 엔진의 실제 쪽 수 */
const tabCounts = (win) =>
  win.evaluate(async () => {
    const s = window.__icepdf.state()
    return Promise.all(
      s.tabs.map(async (t) => {
        const info = t.id === s.activeTabId ? s.info : t.snapshot.info
        const engine = await window.icepdf.engine(t.docId, 'docInfo', {})
        return { shown: info.pageCount, engine: engine.pageCount }
      })
    )
  })
/** 활성 EPUB을 PDF로 변환해 쓰인 글꼴 이름들 */
async function pdfFonts(win, name) {
  const out = path.join(tmp, name)
  await win.evaluate((p) => window.icepdf.engine(window.__icepdf.state().activeDocId, 'exportPdf', { path: p }), out)
  const doc = mupdf.Document.openDocument(fs.readFileSync(out), 'application/pdf')
  const names = new Set()
  doc.loadPage(1).toStructuredText().walk({ onChar: (_c, _o, font) => void names.add(font.getName()) })
  return [...names]
}
const pageSig = (win) =>
  win.evaluate(() => {
    const c = document.querySelector('.page-canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data
    let h = 0
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0
    return h
  })

// ════════ ① EPUB 읽기 글꼴 ════════
let { app, win } = await launch(epub)
await win.evaluate((p) => window.__icepdf.actions.openFile(p), epub) // 같은 책을 두 번째 탭으로
await waitFor(win, () => window.__icepdf.state().tabs.length === 2)
await win.evaluate(() => {
  const s = window.__icepdf.state()
  s.switchTab(s.tabs[0].id)
})
await sleep(800)
const base = await state(win)
const baseCount = base.info.pageCount
report('글꼴 칸 표시 + 기본 = 책 기본 글꼴', (await win.locator('.tb-epub-font').inputValue()) === '' && base.epubFont === '')
report('설치된 글꼴 목록 불러옴', await waitFor(win, () => (window.__icepdf.state().readingFonts?.length ?? 0) > 0))
const fontIds = await win.evaluate(() => window.__icepdf.state().readingFonts.map((f) => f.id))
report('바탕·맑은 고딕이 목록에', fontIds.includes('Batang') && fontIds.includes('Malgun Gothic'), `${fontIds.length}개`)
const sig0 = await pageSig(win)
const defaultPdfFonts = await pdfFonts(win, '기본.pdf')

await win.locator('.tb-epub-font').selectOption('Batang')
report('바탕 선택 → 적용', await waitFor(win, () => window.__icepdf.state().epubFont === 'Batang' && !window.__icepdf.state().busy))
await sleep(1200)
report('화면이 다시 그려짐', (await pageSig(win)) !== sig0)
let counts = await tabCounts(win)
report('두 EPUB 탭 모두 엔진과 같은 쪽 수 (비활성 탭 포함)', counts.length === 2 && counts.every((c) => c.shown === c.engine), JSON.stringify(counts))
const batangCount = counts[0].engine
const batangFonts = await pdfFonts(win, '바탕.pdf')
report('PDF 변환에 고른 글꼴', batangFonts.some((n) => n.includes('ICEPDFReading')) && !defaultPdfFonts.some((n) => n.includes('ICEPDFReading')), `${defaultPdfFonts} → ${batangFonts}`)

// 다크 테마여도 PDF 변환(원래 색 사본)에 글꼴은 유지
await win.locator('.tb-theme.theme-dark').click()
await sleep(800)
const darkFonts = await pdfFonts(win, '다크+바탕.pdf')
report('다크 테마 + 글꼴 → 변환 PDF도 같은 글꼴', darkFonts.some((n) => n.includes('ICEPDFReading')), `${darkFonts}`)
report('다크로 바꿔도 쪽 수 그대로', (await state(win)).info.pageCount === batangCount)
// 쪽을 바로 놓도록 바꾼 링크 읽기가 그대로 동작
const linkCount = await win.evaluate(async () => {
  const s = window.__icepdf.state()
  let n = 0
  for (let p = 0; p < s.info.pageCount; p++) n += (await window.icepdf.engine(s.activeDocId, 'getLinks', { page: p })).length
  return n
})
report('글꼴을 바꾼 EPUB에서도 링크 읽힘', linkCount > 0, `${linkCount}개`)
const guard = await win.evaluate(async () => {
  try {
    await window.icepdf.engine(0, ['setReadingFont'], { font: null })
    return 'called'
  } catch (e) {
    return String(e.message ?? e)
  }
})
report('IPC: 배열 op로 글꼴 연산 우회 불가', guard !== 'called' && guard.includes('잘못된 연산'), guard)

// 맑은 고딕 (굵은 면 있음) → 쪽 수 다시 맞춤
await win.locator('.tb-epub-font').selectOption('Malgun Gothic')
await waitFor(win, () => window.__icepdf.state().epubFont === 'Malgun Gothic' && !window.__icepdf.state().busy)
await sleep(600)
counts = await tabCounts(win)
report('맑은 고딕 → 두 탭 쪽 수 일치', counts.every((c) => c.shown === c.engine), JSON.stringify(counts))
report('글꼴 칸이 포커스를 놓음 (방향키가 글꼴을 바꾸지 않게)', await win.evaluate(() => !document.activeElement?.classList.contains('tb-epub-font')))
await win.locator('.tb-epub-font').selectOption('Batang')
await waitFor(win, () => window.__icepdf.state().epubFont === 'Batang' && !window.__icepdf.state().busy)
await sleep(400)

await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 1 })
}).catch(() => {})
await app.close().catch(() => {})
await sleep(500)
const lib = JSON.parse(fs.readFileSync(path.join(userData, 'library.json'), 'utf8'))
report('설정에 글꼴 저장', lib.settings?.epubFont === 'Batang' && lib.settings?.epubTheme === 'dark', JSON.stringify(lib.settings))

// ── 재시작 → 복원 ──
;({ app, win } = await launch(epub))
await sleep(1200)
let s2 = await state(win)
report('재시작 후 글꼴 복원', s2.epubFont === 'Batang' && (await win.locator('.tb-epub-font').inputValue()) === 'Batang')
report('복원된 글꼴로 배치 (바탕 쪽 수)', s2.info.pageCount === batangCount, `${s2.info.pageCount} / ${batangCount}`)
report('복원 후 PDF 변환도 바탕', (await pdfFonts(win, '재시작.pdf')).some((n) => n.includes('ICEPDFReading')))
await win.locator('.tb-epub-font').selectOption('')
await waitFor(win, () => window.__icepdf.state().epubFont === '' && !window.__icepdf.state().busy)
await sleep(500)
s2 = await state(win)
report("'책 기본 글꼴' → 원래 쪽 수", s2.info.pageCount === baseCount, `${s2.info.pageCount} / ${baseCount}`)
report('책 기본으로 되돌리면 변환 PDF에도 없음', !(await pdfFonts(win, '되돌림.pdf')).some((n) => n.includes('ICEPDFReading')))

// ════════ ② 쪽 번호 칸 ════════
const twoDigitWidth = await win.locator('.tb-page').evaluate((el) => el.getBoundingClientRect().width)
await win.evaluate((p) => window.__icepdf.actions.openFile(p), bigPdf)
await waitFor(win, () => window.__icepdf.state().info?.pageCount === 120)
await win.evaluate(() => window.__icepdf.state().gotoPage(119))
await sleep(500)
const fit = await win.locator('.tb-page').evaluate((el) => ({ v: el.value, sw: el.scrollWidth, cw: el.clientWidth, w: el.getBoundingClientRect().width }))
report('120쪽: 세 자리가 잘리지 않음', fit.v === '120' && fit.sw <= fit.cw, JSON.stringify(fit))
report('쪽 수가 많으면 칸이 넓어짐', fit.w > twoDigitWidth, `${twoDigitWidth} → ${fit.w}`)
await win.locator('.tb-page').click() // 포커스 시 전체 선택
await win.keyboard.type('57')
await sleep(300)
report('치는 도중엔 이동 안 함 (5쪽으로 튀지 않음)', (await state(win)).currentPage === 119 && (await win.locator('.tb-page').inputValue()) === '57')
await win.keyboard.press('Enter')
await sleep(300)
report('Enter → 57쪽', (await state(win)).currentPage === 56 && (await win.locator('.tb-page').inputValue()) === '57')
await win.locator('.tb-page').click()
await win.keyboard.press('Backspace')
await sleep(150)
report('칸을 비울 수 있음 (쪽은 그대로)', (await win.locator('.tb-page').inputValue()) === '' && (await state(win)).currentPage === 56)
await win.keyboard.type('999')
await win.keyboard.press('Enter')
await sleep(200)
report('범위 밖 숫자 + Enter → 이동 안 하고 현재 쪽 번호로', (await state(win)).currentPage === 56 && (await win.locator('.tb-page').inputValue()) === '57')
await win.locator('.tb-page').click()
await win.keyboard.type('3')
await win.keyboard.press('Escape')
await sleep(150)
report('Esc → 입력 취소', (await state(win)).currentPage === 56 && (await win.locator('.tb-page').inputValue()) === '57')
await win.locator('.tb-page').click()
await win.keyboard.press('ArrowUp')
await sleep(200)
report('↑ → 다음 쪽', (await state(win)).currentPage === 57 && (await win.locator('.tb-page').inputValue()) === '58')
await win.keyboard.press('ArrowDown')
await win.keyboard.press('ArrowDown')
await sleep(200)
report('↓ → 이전 쪽', (await state(win)).currentPage === 55)
await win.keyboard.press('Escape')

// ════════ ③ 문장 카드 ════════
await win.evaluate(() =>
  window.__icepdf.state().set({
    cardDraft: { text: '나는 오늘 아침 커피를 마시며 오래된 책을 펼쳤다. 그리고 문장 하나가 마음에 오래 남아 하루 종일 따라다녔다.\n바람이 불었다.', source: '테스트 책' }
  })
)
await win.waitForSelector('.card-modal')
report('배경 24개 (이미지 20 + 단색 4)', (await win.locator('.card-bg').count()) === 24)
const bgImages = await win.locator('.card-bg').evaluateAll((els) => els.filter((e) => e.style.backgroundImage).length)
report('이미지 배경 20개', bgImages === 20, `${bgImages}`)
await win.locator('.card-bg[title="흰색"]').click()
await win.locator('.card-seg button', { hasText: '정사각' }).click()
await sleep(400)

/** 캔버스의 어두운 글자 픽셀 → 줄 띠(band)마다 좌우 끝 */
const bands = () =>
  win.evaluate(() => {
    const c = document.querySelector('.card-canvas')
    const { width: W, height: H } = c
    const d = c.getContext('2d').getImageData(0, 0, W, H).data
    const rows = []
    for (let y = 0; y < H; y++) {
      let min = -1
      let max = -1
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 150) {
          if (min < 0) min = x
          max = x
        }
      }
      rows.push(min < 0 ? null : [min, max])
    }
    const out = []
    let cur = null
    rows.forEach((r, y) => {
      if (r && cur && y - cur.y1 <= 3) {
        cur.y1 = y
        cur.min = Math.min(cur.min, r[0])
        cur.max = Math.max(cur.max, r[1])
      } else if (r) {
        cur = { y0: y, y1: y, min: r[0], max: r[1] }
        out.push(cur)
      }
    })
    return { W, H, bands: out.filter((b) => b.y1 - b.y0 >= 6) }
  })
const near = (a, b, tol = 8) => Math.abs(a - b) <= tol

let b = await bands()
const pad = b.W * 0.12
const body = (r) => r.bands.slice(0, -1) // 마지막 띠 = 출처
const src = (r) => r.bands[r.bands.length - 1]
report('위쪽 따옴표 없음 (첫 글자 줄이 상자 위쪽 아래)', b.bands[0].y0 > b.H * 0.1 - 2 && !b.bands.some((x) => x.y1 < b.H * 0.1), JSON.stringify(b.bands[0]))
report('왼쪽 정렬: 줄마다 왼쪽 끝 = 여백', body(b).every((x) => near(x.min, pad)), JSON.stringify(body(b).map((x) => x.min)))
report('출처 기본 = 오른쪽', src(b).min > b.W / 2 && near(src(b).max, b.W - pad, 30), JSON.stringify(src(b)))

await win.locator('.card-align button', { hasText: '오른쪽' }).click()
await sleep(300)
b = await bands()
const rightEnds = body(b).map((x) => x.max)
report('오른쪽 정렬: 줄마다 오른쪽 끝 = 상자 끝', rightEnds.every((m) => near(m, b.W - pad, 16)), JSON.stringify(rightEnds))
report('오른쪽 정렬: 짧은 줄은 왼쪽이 비어 있음', body(b).some((x) => x.min > pad + 60))

await win.locator('.card-align button', { hasText: '양쪽' }).click()
await sleep(300)
b = await bands()
const lines = body(b)
const fullLines = lines.filter((x) => near(x.min, pad) && near(x.max, b.W - pad, 16))
report('양쪽 정렬: 문단 중간 줄은 양끝이 상자에 맞음', fullLines.length >= lines.length - 2 && fullLines.length >= 2, JSON.stringify(lines.map((x) => [x.min, x.max])))
report('양쪽 정렬: 문단 마지막 줄(짧은 줄)은 늘리지 않음', lines.some((x) => near(x.min, pad) && x.max < b.W - pad - 60))

await win.locator('.card-source-align button', { hasText: '왼쪽' }).click()
await sleep(300)
b = await bands()
report('출처만 왼쪽으로 (본문 정렬과 따로)', near(src(b).min, pad) && src(b).max < b.W - pad - 60, JSON.stringify(src(b)))
await win.locator('.card-source-align button', { hasText: '가운데' }).click()
await sleep(300)
b = await bands()
report('출처 가운데', near((src(b).min + src(b).max) / 2, b.W / 2, 16), JSON.stringify(src(b)))
await win.locator('.card-modal input[type="text"]').fill('')
await sleep(200)
report('출처를 비우면 출처 정렬 버튼 꺼짐', await win.locator('.card-source-align button').first().isDisabled())
await win.keyboard.press('Escape')

await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 1 })
}).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(tmp, { recursive: true, force: true })
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
