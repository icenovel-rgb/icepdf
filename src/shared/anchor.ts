/**
 * 텍스트 앵커 — EPUB 밑줄의 위치를 "쪽 번호"가 아니라 "그 문장 + 앞뒤 문맥"으로 기억한다.
 * 글자 크기를 바꿔 쪽 나눔이 달라져도 문맥으로 제자리를 다시 찾는다(W3C TextQuoteSelector 방식).
 * 비교는 공백을 뺀 문자열로 한다 — 재배치로 줄바꿈 위치가 바뀌어도 흔들리지 않게.
 * 순수 함수만 둔다 (엔진 워커·테스트 공용).
 */
import type { Quad, Rect } from './types'

/** 앞뒤 문맥으로 저장하는 글자 수 */
export const ANCHOR_CONTEXT = 32
/** 비율로 짐작한 쪽 주변을 먼저 찾는 최소 폭(쪽) */
const MIN_WINDOW = 6

/** 한 쪽의 글자 하나 — line은 그 쪽 안에서의 줄 번호 */
export interface PageChar {
  c: string
  quad: Quad
  line: number
}

export interface TextAnchor {
  /** 밑줄 친 글자 (공백 제거) */
  exact: string
  /** 바로 앞 문맥 (공백 제거, 최대 ANCHOR_CONTEXT자) */
  prefix: string
  /** 바로 뒤 문맥 (공백 제거, 최대 ANCHOR_CONTEXT자) */
  suffix: string
  /** 만들 때의 책 속 위치 비율(쪽/전체 쪽) — 찾기 시작점 */
  ratio: number
}

/** 공백 제거 인덱스 [start, end) 를 쪽별로 나눈 구간 */
export interface AnchorSegment {
  page: number
  start: number
  end: number
}

export interface ResolvedAnchor {
  segments: AnchorSegment[]
}

const isSpace = (c: string): boolean => /\s/.test(c)

export function compactText(s: string): string {
  return s.replace(/\s+/g, '')
}

/** 쪽 글자 배열 → 공백 뺀 문자열 + 각 글자의 원래 인덱스 */
export function compactChars(chars: PageChar[]): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  chars.forEach((ch, i) => {
    if (isSpace(ch.c)) return
    text += ch.c
    map.push(i)
  })
  return { text, map }
}

function quadBox(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** 선택 쿼드 안에 중심이 들어오는 글자들의 [첫, 끝] 원래 인덱스 — 없으면 null */
export function charsInQuads(chars: PageChar[], quads: Quad[]): [number, number] | null {
  if (!quads.length) return null
  const boxes = quads.map(quadBox)
  let first = -1
  let last = -1
  chars.forEach((ch, i) => {
    if (isSpace(ch.c)) return
    const [x0, y0, x1, y1] = quadBox(ch.quad)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    if (boxes.some((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3])) {
      if (first < 0) first = i
      last = i
    }
  })
  return first < 0 ? null : [first, last]
}

/** 공백 제거 인덱스 [start, end) 로 앵커 생성 — 문맥은 이웃 쪽까지 이어 붙인다 */
export function buildAnchor(
  pages: { prev: string; cur: string; next: string },
  start: number,
  end: number,
  ratio: number
): TextAnchor {
  return {
    exact: pages.cur.slice(start, end),
    prefix: (pages.prev + pages.cur.slice(0, start)).slice(-ANCHOR_CONTEXT),
    suffix: (pages.cur.slice(end) + pages.next).slice(0, ANCHOR_CONTEXT),
    ratio
  }
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

interface Candidate {
  page: number
  index: number
  context: number
  distance: number
}

/**
 * 쪽 p에서 시작하는 모든 출현 위치를 문맥 점수와 함께.
 * 뒤쪽은 밑줄+뒤 문맥이 다 들어갈 만큼 이어 붙인다 — 큰 글씨로 재배치돼 여러 쪽에 걸쳐도 찾게.
 */
function candidatesOnPage(
  a: TextAnchor,
  p: number,
  guess: number,
  pageCount: number,
  getPage: (i: number) => string
): Candidate[] {
  const cur = getPage(p)
  if (!cur) return []
  const need = cur.length + a.exact.length + a.suffix.length
  let hay = cur
  for (let k = p + 1; k < pageCount && hay.length < need; k++) hay += getPage(k)
  const before = getPage(p - 1)
  const out: Candidate[] = []
  let i = hay.indexOf(a.exact)
  while (i >= 0 && i < cur.length) {
    const context =
      commonSuffixLen(a.prefix, before + hay.slice(0, i)) + commonPrefixLen(a.suffix, hay.slice(i + a.exact.length))
    out.push({ page: p, index: i, context, distance: Math.abs(p - guess) })
    i = hay.indexOf(a.exact, i + 1)
  }
  return out
}

function best(cands: Candidate[]): Candidate | null {
  let top: Candidate | null = null
  for (const c of cands) {
    // 문맥이 우선, 같으면 짐작한 쪽에 가까운 것
    if (!top || c.context > top.context || (c.context === top.context && c.distance < top.distance)) top = c
  }
  return top
}

function toSegments(c: Candidate, length: number, pageCount: number, getPage: (i: number) => string): AnchorSegment[] {
  const segs: AnchorSegment[] = []
  let start = c.index
  let left = length
  for (let page = c.page; left > 0 && page < pageCount; page++, start = 0) {
    const len = getPage(page).length
    if (len === 0) continue // 그림만 있는 쪽 — 건너뛰고 다음 쪽에서 이어진다
    const end = Math.min(len, start + left)
    segs.push({ page, start, end })
    left -= end - start
  }
  return segs
}

/**
 * 앵커가 가리키는 위치를 찾는다. 비율로 짐작한 쪽 주변부터 보고,
 * 거기서 문맥이 충분히 맞는 후보가 없으면 책 전체를 훑는다. 못 찾으면 null.
 * getPage(i) = i쪽의 공백 제거 문자열 (범위 밖이면 '')
 */
export function resolveAnchor(
  a: TextAnchor,
  pageCount: number,
  getPage: (i: number) => string
): ResolvedAnchor | null {
  if (!a.exact || pageCount <= 0) return null
  const guess = Math.max(0, Math.min(pageCount - 1, Math.floor(a.ratio * pageCount)))
  const window = Math.max(MIN_WINDOW, Math.ceil(pageCount * 0.03))
  const near: Candidate[] = []
  for (let d = 0; d <= window; d++) {
    for (const p of d === 0 ? [guess] : [guess - d, guess + d]) {
      if (p >= 0 && p < pageCount) near.push(...candidatesOnPage(a, p, guess, pageCount, getPage))
    }
  }
  // 문맥이 이만큼 맞으면 주변에서 찾은 것으로 확정 (짧은 문맥이면 그 길이까지만 요구)
  const strong = Math.min(16, a.prefix.length + a.suffix.length)
  let pick = best(near)
  if (!pick || pick.context < strong) {
    const all: Candidate[] = []
    for (let p = 0; p < pageCount; p++) all.push(...candidatesOnPage(a, p, guess, pageCount, getPage))
    pick = best(all)
  }
  return pick ? { segments: toSegments(pick, a.exact.length, pageCount, getPage) } : null
}

/** 공백 제거 인덱스 [start, end) → 줄마다 하나씩 감싸는 사각형 */
export function rectsForRange(chars: PageChar[], map: number[], start: number, end: number): Rect[] {
  if (start >= end || start >= map.length) return []
  const from = map[start]
  const to = map[Math.min(end, map.length) - 1]
  const byLine = new Map<number, Rect>()
  for (let i = from; i <= to; i++) {
    const ch = chars[i]
    const [x0, y0, x1, y1] = quadBox(ch.quad)
    const r = byLine.get(ch.line)
    byLine.set(ch.line, r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1])
  }
  return [...byLine.values()]
}
