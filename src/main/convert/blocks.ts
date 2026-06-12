/**
 * kordoc IRBlock[] → 마크다운 재구성.
 * - 페이지 경계마다 이미지 임베드용 마커 문단 삽입
 * - 표: 실제 표는 파이프 표로, 레이아웃 오검출 표는 문단으로 평탄화 (#12)
 *   (kordoc가 일부 PDF에서 HTML <table>을 내보내면 markdownToHwpx가 파이프 표만
 *    파싱하므로 리터럴 태그가 남는다. IRBlock에서 직접 파이프 표를 만들어 회피)
 */

export interface IRCell {
  text: string
  colSpan: number
  rowSpan: number
}

export interface IRTable {
  rows: number
  cols: number
  cells: IRCell[][]
}

export interface IRBlock {
  type: string
  text?: string
  level?: number
  pageNumber?: number
  table?: IRTable
  ordered?: boolean
}

/** 페이지 마커 — 마크다운 특수문자(밑줄 등) 없이 단일 런으로 보존되도록 영숫자만 사용 */
export function pageMarker(page: number): string {
  return `@@ICEPDFPG${String(page).padStart(4, '0')}@@`
}

export const PAGE_MARKER_RE = /@@ICEPDFPG(\d{4})@@/

/** 레이아웃 오검출 표 판별: 비어있는 셀이 대부분이거나 한 셀이 텍스트를 독점 */
function isJunkTable(t: IRTable): boolean {
  const flat = t.cells.flat()
  const nonEmpty = flat.filter((c) => c.text.trim().length > 0)
  if (nonEmpty.length <= 1) return true
  const total = nonEmpty.reduce((s, c) => s + c.text.length, 0)
  const max = Math.max(...nonEmpty.map((c) => c.text.length))
  // 셀이 2~3개뿐인데 한 셀이 85% 이상 → 본문이 표로 잘못 잡힌 것
  if (nonEmpty.length <= 3 && max / total > 0.85) return true
  // 행/열이 큰데 채워진 셀 비율이 25% 미만 → 노이즈
  if (flat.length >= 8 && nonEmpty.length / flat.length < 0.25) return true
  return false
}

function cellText(c: IRCell): string {
  return c.text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
}

function tableToPipe(t: IRTable): string {
  const cols = Math.max(1, t.cols)
  const grid = t.cells.map((row) => {
    const out: string[] = []
    for (const c of row) {
      out.push(cellText(c))
      for (let s = 1; s < (c.colSpan || 1); s++) out.push('')
    }
    while (out.length < cols) out.push('')
    return out.slice(0, cols)
  })
  if (!grid.length) return ''
  const lines = [
    `| ${grid[0].join(' | ')} |`,
    `| ${grid[0].map(() => '---').join(' | ')} |`,
    ...grid.slice(1).map((r) => `| ${r.join(' | ')} |`)
  ]
  return lines.join('\n')
}

function tableToParagraphs(t: IRTable): string {
  return t.cells
    .flat()
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** 블록을 마크다운으로 재구성하고 페이지 경계에 마커를 끼운다 */
export function blocksToMarkdownWithMarkers(blocks: IRBlock[] | undefined, fallback: string): string {
  if (!blocks?.length) return fallback
  const out: string[] = []
  let lastPage = -999
  for (const b of blocks) {
    const pg = b.pageNumber ?? lastPage
    if (pg !== lastPage) {
      out.push(pageMarker(pg))
      lastPage = pg
    }
    if (b.type === 'heading') {
      const level = Math.min(6, Math.max(1, b.level ?? 1))
      const text = (b.text ?? '').replace(/\n+/g, ' ').trim()
      if (text) out.push(`${'#'.repeat(level)} ${text}`)
    } else if (b.type === 'table' && b.table) {
      out.push(isJunkTable(b.table) ? tableToParagraphs(b.table) : tableToPipe(b.table))
    } else if (b.type === 'list_item' || b.type === 'list') {
      const text = (b.text ?? '').trim()
      if (text) out.push(`- ${text}`)
    } else if (b.text) {
      out.push(b.text.trim())
    }
  }
  return out.filter((s) => s.length > 0).join('\n\n')
}
