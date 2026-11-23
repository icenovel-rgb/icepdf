/**
 * v1.10 읽기 기능 e2e (실제 클릭) —
 * ① 도구 숨기기 버튼·위쪽 끝 자동 표시·Tab  ② EPUB 다크/세피아 테마(픽셀 확인, PDF 변환엔 안 구워짐)
 * ③ 읽던 곳 기억(앱 재시작 후 쪽·글자 크기·테마·밑줄 복원)  ⑤ 선택 팝업으로 EPUB 밑줄 → 글자 크기 변경 후에도 유지
 * ⑥ 밑줄 모아보기(이동·삭제)  ④ 문장 카드(PNG 저장·클립보드)  + PDF 형광펜 원문 → 모아보기 → 실행취소
 * 실제 사용자 데이터를 건드리지 않게 임시 폴더를 ICEPDF_USER_DATA 로 넘겨 띄운다.
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const epub = path.join(root, 'samples', 'sample.epub')
const pdf = path.join(root, 'samples', 'sample.pdf')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icepdf-reading-'))
const userData = path.join(tmp, 'userdata')
const cardOut = path.join(tmp, '카드.png')
const pdfOut = path.join(tmp, '다크변환.pdf')

let fail = 0
const report = (n, ok, d = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!ok) fail++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
const S = (win) => (fn, arg) => win.evaluate(fn, arg)
const state = (win) => win.evaluate(() => window.__icepdf.state())

/** 첫 번째 보이는 쪽 캔버스 모서리 픽셀 밝기 (0~255) */
const cornerLuma = (win) =>
  win.evaluate(() => {
    const c = document.querySelector('.page-canvas')
    const d = c.getContext('2d').getImageData(4, 4, 1, 1).data
    return Math.round(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2])
  })

/** 쪽(page) 안의 pt 좌표 두 점을 실제 마우스로 드래그 */
async function dragOnPage(win, page, from, to) {
  const { zoom } = await state(win)
  const box = await win.locator('.page-view').nth(page).boundingBox()
  await win.mouse.move(box.x + from[0] * zoom, box.y + from[1] * zoom)
  await win.mouse.down()
  await win.mouse.move(box.x + to[0] * zoom, box.y + to[1] * zoom, { steps: 12 })
  await win.mouse.up()
  await sleep(350)
}

/** 쪽의 k번째 글줄을 실제 마우스로 끝까지 드래그 (글자 크기와 상관없이 엔진이 알려준 줄 위치로) */
async function dragLine(win, page, k) {
  const q = await win.evaluate(
    async ([pg, idx]) => {
      const r = await window.icepdf.engine(window.__icepdf.state().activeDocId, 'selection', { page: pg, ax: 0, ay: 0, bx: 2000, by: 3000 })
      const line = r.quads[Math.min(idx, r.quads.length - 1)]
      return [line[0], line[1], line[2], line[5]]
    },
    [page, k]
  )
  const y = (q[1] + q[3]) / 2
  await dragOnPage(win, page, [q[0] + 1, y], [q[2] - 1, y])
}

// ════════ 1차 실행 ════════
let { app, win } = await launch(epub)
let st = S(win)
const i0 = (await state(win)).info
report('EPUB 열림 + 문서 키(내용 해시)', i0.kind === 'epub' && /^epub:[0-9a-f]{40}$/.test(i0.key), i0.key)

// ── ① 도구 숨기기 ──
await win.locator('.tb-hide-chrome').click()
await sleep(200)
report('버튼 → 툴바·탭 막대 숨김 (전체화면 아님)', (await win.locator('.toolbar').count()) === 0 && !(await state(win)).fullscreen)
report('위쪽 감지 영역 생김', (await win.locator('.chrome-hotzone').count()) === 1)
await win.mouse.move(400, 2)
await sleep(250)
report('위쪽 끝에 마우스 → 툴바 잠깐 표시', await win.locator('.chrome-peek .toolbar').isVisible())
await win.mouse.move(400, 500)
await sleep(800)
report('마우스가 떠나면 다시 숨음', (await win.locator('.chrome-peek').count()) === 0)
await win.mouse.move(400, 2)
await sleep(250)
await win.locator('.chrome-peek .tb-hide-chrome').click()
await sleep(200)
report('나타난 툴바의 버튼 → 도구 고정', (await win.locator('.app > .toolbar').count()) === 1 && !(await state(win)).chromeHidden)
// 쪽 번호 입력칸에 포커스가 있어도 Tab으로 숨김
await win.locator('.tb-page').click()
await win.keyboard.press('Tab')
await sleep(150)
report('쪽 번호 입력칸 포커스 중 Tab → 숨김', (await state(win)).chromeHidden === true)
await win.keyboard.press('Tab')
await sleep(150)
report('Tab 다시 → 표시', (await state(win)).chromeHidden === false)

// ── ② 테마 ──
const lightLuma = await cornerLuma(win)
await win.locator('.tb-theme.theme-dark').click()
await sleep(1200)
const darkLuma = await cornerLuma(win)
report('다크 테마 → 쪽 바탕이 어두움', lightLuma > 240 && darkLuma < 60, `${lightLuma} → ${darkLuma}`)
report('다크 테마 쪽 수 그대로', (await state(win)).info.pageCount === i0.pageCount)
await win.locator('.tb-theme.theme-sepia').click()
await sleep(1200)
const sepiaLuma = await cornerLuma(win)
report('세피아 테마 → 미색 바탕', sepiaLuma > 200 && sepiaLuma < 245, `${sepiaLuma}`)
await win.locator('.tb-theme.theme-dark').click()
await sleep(1000)

// 다크로 읽는 중 PDF 변환 → 변환본에는 원래 색(흰 바탕)
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  dialog.showMessageBox = async () => ({ response: 0 })
}, pdfOut)
await win.locator('.tb-convert-pdf').click()
await win.waitForFunction(() => window.__icepdf.state().tabs.length === 2, null, { timeout: 20000 })
await sleep(1200)
const convLuma = await cornerLuma(win)
report('다크 테마로 PDF 변환 → 변환본은 흰 바탕', fs.existsSync(pdfOut) && convLuma > 240, `${convLuma}`)
await st(() => {
  const s = window.__icepdf.state()
  s.switchTab(s.tabs[0].id)
})
await sleep(800)
report('EPUB 탭으로 돌아오면 다시 다크', (await cornerLuma(win)) < 60)

// ── ⑤ 선택 팝업으로 밑줄 ──
await win.locator('.tb-btn[title="텍스트 선택"]').click()
await dragOnPage(win, 0, [44, 121], [330, 121])
const sel = (await state(win)).selection
report('글자 드래그 → 선택', !!sel && sel.text.length > 5, sel?.text)
report('선택 팝업 표시', await win.locator('.sel-popup').isVisible())
await win.locator('.sel-popup .sel-swatch').nth(1).click()
await sleep(600)
let s1 = await state(win)
report('밑줄 1개 기록 + 쪽에 표시', s1.epubNotes.length === 1 && (await win.locator('.note-mark').count()) >= 1, `${s1.epubNotes.length}`)
const noteText = s1.epubNotes[0]?.text ?? ''
report('밑줄 원문 = 선택 글자', noteText === sel?.text.trim(), noteText)

// 두 번째 밑줄(밑줄 스타일) — 다른 문단
await dragOnPage(win, 0, [44, 168], [250, 168])
await win.locator('.sel-popup .sel-btn').first().click() // 밑줄 모드
await win.locator('.sel-popup .sel-swatch').nth(3).click()
await sleep(600)
s1 = await state(win)
report('밑줄 스타일 기록', s1.epubNotes.length === 2 && s1.epubNotes[1].style === 'underline', JSON.stringify(s1.epubNotes.map((n) => n.style)))

// 글자 크기 변경 → 쪽이 바뀌어도 밑줄 유지
await win.locator('.tb-font-up').click()
await sleep(700)
await win.locator('.tb-font-up').click()
await sleep(1500)
s1 = await state(win)
report('18pt 재배치 후에도 밑줄 위치 찾음', s1.info.fontSize === 18 && s1.notes.every((n) => n.page >= 0), JSON.stringify(s1.notes.map((n) => n.page)))

// ── ⑥ 모아보기 ──
await win.locator('.tb-btn[title^="밑줄 모아보기"]').click()
await sleep(300)
report('모아보기 2개', (await win.locator('.note-row').count()) === 2)
await st(() => window.__icepdf.state().gotoPage(window.__icepdf.state().info.pageCount - 1))
await sleep(500)
await win.locator('.note-row').first().click()
await sleep(600)
s1 = await state(win)
report('항목 클릭 → 그 쪽으로 이동', s1.currentPage === s1.notes[0].page, `${s1.currentPage} / ${s1.notes[0].page}`)

// ── ④ 문장 카드 ──
await win.locator('.note-row').first().hover()
await win.locator('.note-row').first().locator('button[title="문장 카드 이미지 만들기"]').click()
await sleep(500)
report('카드 창 열림 + 문장 채움', await win.locator('.card-modal').isVisible())
report('카드 문장 = 밑줄 원문', (await win.locator('.card-modal textarea').inputValue()) === (await state(win)).notes[0].text)
await win.locator('.card-bg[title="밤하늘"]').click()
await win.locator('.card-seg button', { hasText: '정사각' }).click()
await sleep(700)
const canvasInfo = await st(() => {
  const c = document.querySelector('.card-canvas')
  const d = c.getContext('2d').getImageData(10, 10, 1, 1).data
  return { w: c.width, h: c.height, luma: 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2] }
})
report('정사각 1080×1080 + 밤하늘 배경(어두움)', canvasInfo.w === 1080 && canvasInfo.h === 1080 && canvasInfo.luma < 80, JSON.stringify(canvasInfo))
await app.evaluate(({ dialog }, p) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
}, cardOut)
await win.locator('.card-actions button', { hasText: '이미지 저장' }).click()
await sleep(800)
const png = fs.existsSync(cardOut) ? fs.readFileSync(cardOut) : Buffer.alloc(0)
report('PNG 저장', png.length > 20000 && png.subarray(1, 4).toString() === 'PNG', `${png.length}B`)
await win.locator('.card-actions button', { hasText: '클립보드 복사' }).click()
await sleep(600)
const clip = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
report('클립보드에 이미지', clip.width === 1080 && clip.height === 1080, JSON.stringify(clip))
await win.keyboard.press('Delete') // 카드 창이 떠 있을 땐 뒤 문서로 새면 안 된다
await sleep(200)
report('카드 창에서 Delete가 뒤 문서로 안 샘', (await state(win)).info.pageCount === s1.info.pageCount)
await win.keyboard.press('Escape')
await sleep(200)
report('Esc → 카드 창 닫힘', (await win.locator('.card-modal').count()) === 0)

// 모아보기에서 삭제
await win.locator('.note-row').nth(1).hover()
await win.locator('.note-row').nth(1).locator('button[title="삭제"]').click()
await sleep(500)
report('모아보기 삭제 → 1개', (await state(win)).epubNotes.length === 1 && (await win.locator('.note-row').count()) === 1)

// 읽던 곳: 4쪽으로 이동 후 종료
await st(() => window.__icepdf.state().gotoPage(3))
await sleep(1500)
await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 1 })
}).catch(() => {})
await app.close().catch(() => {})
await sleep(500)

const libPath = path.join(userData, 'library.json')
const lib = fs.existsSync(libPath) ? JSON.parse(fs.readFileSync(libPath, 'utf8')) : null
const rec = lib?.books?.[i0.key]
report('library.json 은 임시 userData 에 기록', !!lib, libPath)
report('기록: 4쪽·18pt·밑줄 1개·다크', rec?.lastPage === 3 && rec?.fontSize === 18 && rec?.notes?.length === 1 && lib?.settings?.epubTheme === 'dark', JSON.stringify({ p: rec?.lastPage, f: rec?.fontSize, n: rec?.notes?.length, t: lib?.settings?.epubTheme }))

// ════════ 2차 실행 — 읽던 곳 복원 ════════
;({ app, win } = await launch(epub))
st = S(win)
await sleep(1500)
let s2 = await state(win)
report('다시 열면 4쪽부터', s2.currentPage === 3, `${s2.currentPage + 1}쪽`)
report('글자 크기 18pt 복원', s2.info.fontSize === 18)
report('이어 보기 안내', (s2.toast ?? '').includes('4쪽'), s2.toast)
report('다크 테마 복원', s2.epubTheme === 'dark' && (await cornerLuma(win)) < 60)
report('밑줄 복원(위치 찾음)', s2.epubNotes.length === 1 && s2.notes[0]?.page >= 0)

// EPUB 지우개 → 밑줄 삭제
await st(() => {
  const s = window.__icepdf.state()
  s.gotoPage(s.notes[0].page)
})
await sleep(800)
const mark = s2.noteMarks[s2.notes[0].page][0].rects[0]
await win.locator('.tb-btn[title^="지우개"]').click()
const pv = await win.locator(`.page-view`).nth(s2.notes[0].page).boundingBox()
await win.mouse.click(pv.x + ((mark[0] + mark[2]) / 2) * s2.zoom, pv.y + ((mark[1] + mark[3]) / 2) * s2.zoom)
await sleep(600)
report('EPUB 지우개로 밑줄 삭제', (await state(win)).epubNotes.length === 0)

// ── 인쇄용 렌더는 다크로 읽는 중에도 원래 색 (겹쳐 호출해도 화면 테마는 그대로) ──
const printProbe = await st(async () => {
  const s = window.__icepdf.state()
  const luma = async (plain) => {
    const r = await window.icepdf.engine(s.activeDocId, 'render', { page: 0, scale: 0.2, plain })
    const bmp = await createImageBitmap(new Blob([r.png], { type: 'image/png' }))
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(1, 1, 1, 1).data
    return Math.round(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2])
  }
  const [a, b] = await Promise.all([luma(true), luma(true)]) // 인쇄 미리보기 두 번 겹침
  return { plainA: a, plainB: b, screen: await luma(false) }
})
report('인쇄 렌더 = 흰 바탕, 화면 = 다크 유지', printProbe.plainA > 240 && printProbe.plainB > 240 && printProbe.screen < 60, JSON.stringify(printProbe))

// ── 같은 책을 두 탭에서 열고 각각 밑줄 → 서로 지우지 않는다 ──
await win.locator('.tb-btn[title="텍스트 선택"]').click()
await st((p) => window.__icepdf.actions.openFile(p), epub)
await win.waitForFunction(() => window.__icepdf.state().tabs.length === 2, null, { timeout: 20000 })
await sleep(1200)
await st(() => window.__icepdf.state().gotoPage(0))
await sleep(600)
await dragLine(win, 0, 3)
await win.locator('.sel-popup .sel-swatch').nth(2).click()
await sleep(700)
await st(() => {
  const s = window.__icepdf.state()
  s.switchTab(s.tabs[0].id)
})
await sleep(800)
await st(() => window.__icepdf.state().gotoPage(0))
await sleep(600)
await dragLine(win, 0, 5)
await win.locator('.sel-popup .sel-swatch').nth(4).click()
await sleep(700)
report('같은 책 두 탭에서 각각 밑줄 → 둘 다 남음', (await state(win)).epubNotes.length === 2, `${(await state(win)).epubNotes.length}개`)

// ── PDF 형광펜: 원문 저장 → 모아보기 → 실행취소 ──
await st((p) => window.__icepdf.actions.openFile(p), pdf)
await win.waitForFunction(() => window.__icepdf.state().info?.kind === 'pdf', null, { timeout: 20000 })
await sleep(1200)
await win.locator('.tb-btn[title="텍스트 선택"]').click()
const words = await st(async () => {
  // 첫 쪽에서 글자가 있는 줄의 좌표를 엔진으로 찾는다
  const r = await window.icepdf.engine(window.__icepdf.state().activeDocId, 'selection', { page: 0, ax: 0, ay: 0, bx: 600, by: 800 })
  const q = r.quads[0]
  return q ? [q[0], q[1], q[2], q[5]] : null
})
await dragOnPage(win, 0, [words[0] + 1, (words[1] + words[3]) / 2], [words[2] - 1, (words[1] + words[3]) / 2])
const psel = (await state(win)).selection
await win.locator('.sel-popup .sel-swatch').first().click()
await sleep(800)
let s3 = await state(win)
report('PDF 팝업 형광펜 → 편집됨', s3.dirty && s3.canUndo)
await win.locator('.sidebar-tabs button', { hasText: '밑줄' }).click()
await sleep(700)
s3 = await state(win)
report('PDF 모아보기에 원문 표시', s3.notes.length === 1 && s3.notes[0].text === psel.text.trim(), s3.notes[0]?.text)
await win.keyboard.press('Control+z')
await sleep(900)
report('실행취소 → 모아보기에서 사라짐', (await state(win)).notes.length === 0)

// ── 도구를 숨긴 채 마지막 탭까지 닫아도 도구가 다시 보인다 ──
await win.locator('.tb-hide-chrome').click()
await sleep(200)
await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 0 }) // 저장 안 한 탭 닫기 확인 → 확인
})
for (let i = 0; i < 4 && (await state(win)).tabs.length > 0; i++) {
  await st(() => {
    const s = window.__icepdf.state()
    return window.__icepdf.actions.closeTabById(s.activeTabId)
  })
  await sleep(400)
}
report('숨긴 채 마지막 탭 닫기 → 도구 다시 보임', (await state(win)).tabs.length === 0 && (await win.locator('.app > .toolbar').count()) === 1)

await app.evaluate(({ dialog }) => {
  dialog.showMessageBox = async () => ({ response: 1 })
}).catch(() => {})
await app.close().catch(() => {})
await sleep(500)
const lib2 = JSON.parse(fs.readFileSync(libPath, 'utf8'))
report('library.json: 두 탭의 밑줄 2개 모두 저장', lib2.books[i0.key]?.notes?.length === 2, `${lib2.books[i0.key]?.notes?.length}개`)

console.log(fail ? `\n${fail}개 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
