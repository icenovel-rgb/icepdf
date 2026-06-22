/**
 * 인쇄 — 페이지를 PNG로 렌더해 모아찍기(N-up) 그리드로 배치한다.
 * 미리보기(PrintModal)와 실제 인쇄가 동일한 레이아웃 규칙을 공유해 WYSIWYG를 보장한다.
 */
import { eng } from './engine'

export type PerSheet = 1 | 2 | 4 | 6 | 8
export type Orientation = 'portrait' | 'landscape'

/** 모아찍기 선택지 (한 장에 몇 쪽) */
export const PER_SHEET_OPTIONS: PerSheet[] = [1, 2, 4, 6, 8]

/** 용지 방향 선택지 */
export const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: 'portrait', label: '세로' },
  { value: 'landscape', label: '가로' }
]

/** 세로(A4) 용지 기준 모아찍기 그리드 — 가로 우선(좌→우, 위→아래) 배치 */
export const SHEET_GRID: Record<PerSheet, { rows: number; cols: number }> = {
  1: { rows: 1, cols: 1 },
  2: { rows: 2, cols: 1 },
  4: { rows: 2, cols: 2 },
  6: { rows: 3, cols: 2 },
  8: { rows: 4, cols: 2 }
}

/** 방향에 맞춘 그리드 — 가로 용지는 행/열을 교환해 열을 늘린다(2쪽=좌우, 6쪽=2행3열 등) */
export function gridFor(perSheet: PerSheet, orientation: Orientation): { rows: number; cols: number } {
  const g = SHEET_GRID[perSheet]
  return orientation === 'landscape' ? { rows: g.cols, cols: g.rows } : g
}

/** A4 용지 mm 크기 (방향 반영) */
export function sheetSizeMm(orientation: Orientation): { w: number; h: number } {
  return orientation === 'landscape' ? { w: 297, h: 210 } : { w: 210, h: 297 }
}

/** 인쇄 해상도 배율(포인트당 px). 약 150dpi 상당 — 1쪽 풀페이지도 무난한 품질 */
export const PRINT_SCALE = 2

export interface RenderedPage {
  /** 0-based 페이지 번호 */
  page: number
  /** PNG data URL */
  src: string
  /** 렌더 px 크기 (종횡비용) */
  w: number
  h: number
}

/** "1-5,8" → 0-based 페이지 인덱스(정렬·중복제거·범위클램프). 빈 문자열이면 전체 페이지 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const trimmed = spec.trim()
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i)
  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = parseInt(m[2], 10)
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) pages.add(i - 1)
    } else if (/^\d+$/.test(part.trim())) {
      pages.add(parseInt(part.trim(), 10) - 1)
    }
  }
  return [...pages].filter((p) => p >= 0 && p < pageCount).sort((a, b) => a - b)
}

/** 페이지 배열을 한 시트당 perSheet개씩 묶는다 */
export function chunkSheets<T>(items: T[], perSheet: number): T[][] {
  const sheets: T[][] = []
  for (let i = 0; i < items.length; i += perSheet) sheets.push(items.slice(i, i + perSheet))
  return sheets
}

/** PNG ArrayBuffer → data URL (큰 이미지도 안전하게 Blob+FileReader 경유) */
function pngToDataUrl(png: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error ?? new Error('이미지 변환 실패'))
    fr.readAsDataURL(new Blob([png], { type: 'image/png' }))
  })
}

/** 지정 페이지들을 순차 렌더해 data URL로 변환 (엔진은 단일 워커라 순차가 합리적) */
export async function renderPagesForPrint(
  pages: number[],
  scale = PRINT_SCALE,
  onProgress?: (done: number, total: number) => void
): Promise<RenderedPage[]> {
  const out: RenderedPage[] = []
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const r = await eng('render', { page, scale })
    const src = await pngToDataUrl(r.png)
    out.push({ page, src, w: r.width, h: r.height })
    onProgress?.(i + 1, pages.length)
  }
  return out
}

/** 페이지가 가로 방향(폭>높이)인지 */
export function isLandscapePage(p: RenderedPage): boolean {
  return p.w > p.h
}

/**
 * 자기완결 인쇄 HTML 생성. 메인 프로세스가 숨김 창에 그대로 로드해 인쇄한다.
 * **1쪽 인쇄와 모아찍기는 로직을 분리** — 1쪽은 용지 방향을 페이지에 맞춰 여백 없이
 * 꽉 채우고(모아찍기 격자/gap을 타지 않음), 2쪽 이상만 grid 모아찍기를 쓴다.
 */
export function buildPrintHtml(
  pages: RenderedPage[],
  perSheet: PerSheet,
  orientation: Orientation = 'portrait'
): string {
  return perSheet === 1 ? buildSingleHtml(pages) : buildNupHtml(pages, perSheet, orientation)
}

/**
 * 1쪽 인쇄 — 각 페이지를 1장에 꽉 채운다. 용지 방향은 **그 페이지 방향에 자동**으로
 * 맞춰(named @page) 세로 PDF는 세로 용지, 가로 PDF는 가로 용지로 나가 여백이 최소화된다.
 * 여백(padding)·gap 없음. orientation 인자는 무시(페이지가 결정).
 */
function buildSingleHtml(pages: RenderedPage[]): string {
  const body = pages
    .map((p) => {
      const cls = isLandscapePage(p) ? 'sheet land' : 'sheet port'
      return `<section class="${cls}"><img src="${p.src}" alt=""></section>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
@page port { size: A4 portrait; margin: 0; }
@page land { size: A4 landscape; margin: 0; }
html, body { background: #fff; }
.sheet { display: flex; align-items: center; justify-content: center; overflow: hidden; page-break-after: always; break-after: page; }
.sheet.port { width: 210mm; height: 297mm; page: port; }
.sheet.land { width: 297mm; height: 210mm; page: land; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.sheet img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body>${body}</body></html>`
}

/** 모아찍기(2·4·6·8쪽) — mm 고정 A4 시트 + grid + page-break. 용지 방향은 사용자 선택. */
function buildNupHtml(pages: RenderedPage[], perSheet: PerSheet, orientation: Orientation): string {
  const { rows, cols } = gridFor(perSheet, orientation)
  const { w, h } = sheetSizeMm(orientation)
  const sheets = chunkSheets(pages, perSheet)
  const body = sheets
    .map((sheet) => {
      const cells = sheet.map((p) => `<div class="cell"><img src="${p.src}" alt=""></div>`).join('')
      return `<section class="sheet">${cells}</section>`
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4 ${orientation}; margin: 0; }
html, body { background: #fff; }
.sheet {
  width: ${w}mm; height: ${h}mm; padding: 8mm;
  display: grid;
  grid-template-columns: repeat(${cols}, 1fr);
  grid-template-rows: repeat(${rows}, 1fr);
  gap: 4mm;
  page-break-after: always;
  break-after: page;
}
.sheet:last-child { page-break-after: auto; break-after: auto; }
.cell { display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cell img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body>${body}</body></html>`
}
