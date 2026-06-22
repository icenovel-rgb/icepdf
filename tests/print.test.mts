/** 인쇄 핵심 로직 단위 검증 — 범위 파서 / 모아찍기 그리드 / 인쇄 HTML 생성 */
import {
  parsePageSpec,
  chunkSheets,
  SHEET_GRID,
  gridFor,
  sheetSizeMm,
  buildPrintHtml,
  PER_SHEET_OPTIONS,
  ORIENTATION_OPTIONS,
  type RenderedPage
} from '../src/renderer/src/lib/print'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ── parsePageSpec ──
check('빈 입력 → 전체 페이지', eq(parsePageSpec('', 5), [0, 1, 2, 3, 4]))
check('범위+단일 (1-3,5)', eq(parsePageSpec('1-3,5', 10), [0, 1, 2, 4]))
check('범위 밖 제외 (99/5쪽)', parsePageSpec('99', 5).length === 0)
check('역순 범위 정규화 (3-1)', eq(parsePageSpec('3-1', 10), [0, 1, 2]))
check('중복 제거·정렬 (5,1,1,2)', eq(parsePageSpec('5,1,1,2', 10), [0, 1, 4]))
check('공백 허용 (" 2 - 4 ")', eq(parsePageSpec(' 2 - 4 ', 10), [1, 2, 3]))

// ── 모아찍기 옵션/그리드 ──
check('옵션 = 1·2·4·6·8', eq(PER_SHEET_OPTIONS, [1, 2, 4, 6, 8]))
check('grid 1 = 1x1', SHEET_GRID[1].rows === 1 && SHEET_GRID[1].cols === 1)
check('grid 2 = 2x1', SHEET_GRID[2].rows === 2 && SHEET_GRID[2].cols === 1)
check('grid 4 = 2x2', SHEET_GRID[4].rows === 2 && SHEET_GRID[4].cols === 2)
check('grid 6 = 3x2', SHEET_GRID[6].rows === 3 && SHEET_GRID[6].cols === 2)
check('grid 8 = 4x2', SHEET_GRID[8].rows === 4 && SHEET_GRID[8].cols === 2)

// ── chunkSheets ──
check('chunk perSheet=2', eq(chunkSheets([0, 1, 2, 3, 4], 2), [[0, 1], [2, 3], [4]]))
check('chunk perSheet=4 (8쪽)', chunkSheets([0, 1, 2, 3, 4, 5, 6, 7], 4).length === 2)

// ── buildPrintHtml ──
const mk = (n: number): RenderedPage[] =>
  Array.from({ length: n }, (_, i) => ({ page: i, src: 'data:image/png;base64,AAAA', w: 100, h: 140 }))
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length

const html4 = buildPrintHtml(mk(4), 4)
check('4쪽@4: 시트 1개', count(html4, /<section class="sheet">/g) === 1)
check('4쪽@4: 셀 4개', count(html4, /<div class="cell">/g) === 4)
check('4쪽@4: grid 2열', html4.includes('grid-template-columns: repeat(2, 1fr)'))
check('4쪽@4: grid 2행', html4.includes('grid-template-rows: repeat(2, 1fr)'))

const html8at4 = buildPrintHtml(mk(8), 4)
check('8쪽@4: 시트 2개', count(html8at4, /<section class="sheet">/g) === 2)
check('8쪽@4: 셀 8개', count(html8at4, /<div class="cell">/g) === 8)

const html2 = buildPrintHtml(mk(2), 2)
check('2쪽@2: 2행1열', html2.includes('grid-template-rows: repeat(2, 1fr)') && html2.includes('grid-template-columns: repeat(1, 1fr)'))

// ── 1쪽 인쇄(모아찍기와 분리): 페이지 방향 자동 + 여백/격자 없음 ──
const single3 = buildPrintHtml(mk(3), 1) // mk는 세로 페이지(w100<h140)
check('1쪽 3장: 시트 3개', count(single3, /<section class="sheet/g) === 3)
check('1쪽 세로 페이지 → 세로 용지', single3.includes('class="sheet port"') && single3.includes('@page port'))
check('1쪽: 모아찍기 격자 없음', !single3.includes('grid-template'))
check('1쪽: 여백(padding 8mm) 없음', !single3.includes('padding: 8mm'))
const singleLand = buildPrintHtml([{ page: 0, src: 'data:,', w: 140, h: 100 }], 1)
check('1쪽 가로 페이지 → 가로 용지', singleLand.includes('class="sheet land"') && singleLand.includes('@page land'))
check('1쪽: orientation 인자 무시(세로 페이지는 가로 지정해도 세로 용지)', buildPrintHtml(mk(1), 1, 'landscape').includes('class="sheet port"'))

check('A4 세로 용지', html4.includes('size: A4 portrait'))
check('페이지 나눔', html4.includes('page-break-after: always'))
check('이미지 종횡비 유지', html4.includes('object-fit: contain'))
check('자기완결 HTML', html4.startsWith('<!doctype html>'))

// ── 용지 방향 ──
check('방향 옵션 = 세로/가로', eq(ORIENTATION_OPTIONS.map((o) => o.value), ['portrait', 'landscape']))
check('세로 그리드 2쪽 = 2행1열', eq(gridFor(2, 'portrait'), { rows: 2, cols: 1 }))
check('가로 그리드 2쪽 = 1행2열(좌우)', eq(gridFor(2, 'landscape'), { rows: 1, cols: 2 }))
check('가로 그리드 6쪽 = 2행3열', eq(gridFor(6, 'landscape'), { rows: 2, cols: 3 }))
check('가로 그리드 8쪽 = 2행4열', eq(gridFor(8, 'landscape'), { rows: 2, cols: 4 }))
check('세로 용지 = 210×297', eq(sheetSizeMm('portrait'), { w: 210, h: 297 }))
check('가로 용지 = 297×210', eq(sheetSizeMm('landscape'), { w: 297, h: 210 }))

const landscape2 = buildPrintHtml(mk(2), 2, 'landscape')
check('가로 2쪽: A4 landscape', landscape2.includes('size: A4 landscape'))
check('가로 2쪽: 용지 폭 297mm', landscape2.includes('width: 297mm') && landscape2.includes('height: 210mm'))
check('가로 2쪽: grid 2열(좌우)', landscape2.includes('grid-template-columns: repeat(2, 1fr)'))

const portrait2 = buildPrintHtml(mk(2), 2, 'portrait')
check('세로 2쪽: 용지 폭 210mm', portrait2.includes('width: 210mm') && portrait2.includes('height: 297mm'))
check('세로 2쪽: grid 1열', portrait2.includes('grid-template-columns: repeat(1, 1fr)'))

check('방향 생략 시 기본 세로', buildPrintHtml(mk(2), 2) === portrait2)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
