/**
 * 문장 카드 — 책 속 문장을 배경 위에 얹어 한 장의 이미지로.
 * 줄바꿈·크기 맞춤은 측정 함수를 받는 순수 함수(테스트 가능), 그리기는 Canvas 2D.
 */

export type CardRatio = '1:1' | '4:5' | '9:16'
/** 본문 정렬 — justify = 양쪽 정렬(문단 마지막 줄은 왼쪽) */
export type CardAlign = 'left' | 'center' | 'right' | 'justify'
/** 출처 정렬 (본문과 따로) */
export type SourceAlign = 'left' | 'center' | 'right'

export const CARD_ALIGNS: { id: CardAlign; label: string }[] = [
  { id: 'left', label: '왼쪽' },
  { id: 'center', label: '가운데' },
  { id: 'right', label: '오른쪽' },
  { id: 'justify', label: '양쪽' }
]

export const SOURCE_ALIGNS: { id: SourceAlign; label: string }[] = [
  { id: 'left', label: '왼쪽' },
  { id: 'center', label: '가운데' },
  { id: 'right', label: '오른쪽' }
]

export const CARD_RATIOS: { id: CardRatio; label: string; width: number; height: number }[] = [
  { id: '1:1', label: '정사각 1:1', width: 1080, height: 1080 },
  { id: '4:5', label: '세로 4:5', width: 1080, height: 1350 },
  { id: '9:16', label: '스토리 9:16', width: 1080, height: 1920 }
]

export function cardSize(ratio: CardRatio): { width: number; height: number } {
  const r = CARD_RATIOS.find((x) => x.id === ratio) ?? CARD_RATIOS[1]
  return { width: r.width, height: r.height }
}

type Measure = (s: string) => number

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null

/** 화면에 한 글자로 보이는 단위 (결합 문자·이모지·풀어 쓴 자모가 쪼개지지 않게) */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : [...s]
}

/** 한 덩어리를 글자 단위로 잘라 폭에 맞춘다 (띄어쓰기 없는 긴 한글·URL) */
function breakChars(word: string, maxWidth: number, measure: Measure, lines: string[]): string {
  let line = ''
  for (const ch of graphemes(word)) {
    if (line && measure(line + ch) > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  return line
}

/** 줄 하나 — last = 문단의 마지막 줄 (양쪽 정렬에서 늘리지 않는다) */
export interface CardLine {
  text: string
  last: boolean
}

/** 띄어쓰기 우선 줄바꿈 — 문단(줄바꿈)은 유지, 빈 줄은 하나로 */
export function wrapLines(text: string, maxWidth: number, measure: Measure): CardLine[] {
  const out: CardLine[] = []
  for (const para of text.trim().split(/\r?\n/)) {
    const words = para.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    if (!words.length) {
      if (out.length && out[out.length - 1].text !== '') out.push({ text: '', last: true })
      continue
    }
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = measure(word) <= maxWidth ? word : breakChars(word, maxWidth, measure, lines)
    }
    if (line) lines.push(line)
    lines.forEach((t, i) => out.push({ text: t, last: i === lines.length - 1 }))
  }
  return out
}

export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  return wrapLines(text, maxWidth, measure).map((l) => l.text)
}

/** 양쪽 정렬로 벌릴 빈칸이 폭의 이만큼을 넘으면(줄이 너무 짧으면) 왼쪽 정렬로 둔다 */
const JUSTIFY_MAX_SLACK = 0.35

/**
 * 양쪽 정렬 — 줄을 조각으로 나눠 각 조각의 왼쪽 위치(상자 왼쪽 기준)를 돌려준다.
 * 띄어쓰기가 있으면 낱말 사이를, 없으면(긴 한글 덩어리) 글자 사이를 고르게 벌린다.
 */
export function justifyLine(line: string, width: number, measure: Measure): { text: string; x: number }[] {
  const words = line.split(' ').filter(Boolean)
  const pieces = words.length > 1 ? words : graphemes(line)
  const natural = pieces.reduce((sum, p) => sum + measure(p), 0)
  // 원래 있던 띄어쓰기 폭은 "벌린 양"에서 뺀다
  const spaces = words.length > 1 ? measure(' ') * (words.length - 1) : 0
  const slack = width - natural
  if (pieces.length < 2 || slack <= 0 || slack - spaces > width * JUSTIFY_MAX_SLACK) return [{ text: line, x: 0 }]
  const gap = slack / (pieces.length - 1)
  let x = 0
  return pieces.map((text) => {
    const at = x
    x += measure(text) + gap
    return { text, x: at }
  })
}

export interface FitOptions {
  width: number
  height: number
  maxSize: number
  minSize: number
  lineHeight: number
  measureAt: (size: number) => Measure
}

/** 상자에 들어가는 가장 큰 글자 크기 (최소 크기 아래로는 줄이지 않는다) */
export function fitLines(text: string, o: FitOptions): { size: number; lines: CardLine[] } {
  for (let size = o.maxSize; size >= o.minSize; size -= 2) {
    const lines = wrapLines(text, o.width, o.measureAt(size))
    if (lines.length * size * o.lineHeight <= o.height) return { size, lines }
  }
  return { size: o.minSize, lines: wrapLines(text, o.width, o.measureAt(o.minSize)) }
}

export function fitText(text: string, o: FitOptions): { size: number; lines: string[] } {
  const fit = fitLines(text, o)
  return { size: fit.size, lines: fit.lines.map((l) => l.text) }
}

export interface CardSpec {
  width: number
  height: number
  /** 배경 — 이미지(가운데 맞춰 꽉 채움) 또는 단색 */
  image: CanvasImageSource | null
  imageSize: { w: number; h: number } | null
  color: string
  /** 글자가 잘 보이게 덮는 막 (0~0.7) — 밝은 글자면 어둡게, 어두운 글자면 밝게 */
  shade: number
  ink: string
  font: string
  maxFontSize: number
  align: CardAlign
  sourceAlign: SourceAlign
  text: string
  source: string
}

const LINE_HEIGHT = 1.62
const MIN_FONT = 26

function isLightColor(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150
}

function drawBackground(ctx: CanvasRenderingContext2D, s: CardSpec): void {
  ctx.fillStyle = s.color
  ctx.fillRect(0, 0, s.width, s.height)
  if (s.image && s.imageSize) {
    const scale = Math.max(s.width / s.imageSize.w, s.height / s.imageSize.h)
    const w = s.imageSize.w * scale
    const h = s.imageSize.h * scale
    ctx.drawImage(s.image, (s.width - w) / 2, (s.height - h) / 2, w, h)
  }
  if (s.shade > 0) {
    ctx.fillStyle = isLightColor(s.ink) ? `rgba(0,0,0,${s.shade})` : `rgba(255,255,255,${s.shade})`
    ctx.fillRect(0, 0, s.width, s.height)
  }
}

/** 정렬 → 캔버스 기준점 x와 textAlign */
function anchorFor(align: SourceAlign, width: number, pad: number): { x: number; textAlign: CanvasTextAlign } {
  if (align === 'center') return { x: width / 2, textAlign: 'center' }
  if (align === 'right') return { x: width - pad, textAlign: 'right' }
  return { x: pad, textAlign: 'left' }
}

function drawLine(ctx: CanvasRenderingContext2D, line: CardLine, y: number, s: CardSpec, pad: number, boxW: number): void {
  if (s.align === 'justify' && !line.last) {
    ctx.textAlign = 'left'
    for (const piece of justifyLine(line.text, boxW, (t) => ctx.measureText(t).width)) {
      ctx.fillText(piece.text, pad + piece.x, y)
    }
    return
  }
  const { x, textAlign } = anchorFor(s.align === 'justify' ? 'left' : s.align, s.width, pad)
  ctx.textAlign = textAlign
  ctx.fillText(line.text, x, y)
}

/** 카드 한 장을 그린다 */
export function drawCard(ctx: CanvasRenderingContext2D, s: CardSpec): void {
  ctx.save()
  drawBackground(ctx, s)
  const pad = s.width * 0.12
  const boxW = s.width - pad * 2
  const fontOf = (size: number): string => `${size}px "${s.font}", "Malgun Gothic", serif`
  const source = s.source.trim()
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = s.ink

  // 본문 — 상자에 맞춰 크기 자동 (출처가 있으면 아래 자리를 비워 둔다)
  const boxTop = Math.max(pad, s.height * 0.1)
  const boxBottom = s.height - (source ? pad * 1.35 : pad)
  const fit = fitLines(s.text, {
    width: boxW,
    height: boxBottom - boxTop,
    maxSize: Math.max(MIN_FONT, s.maxFontSize),
    minSize: MIN_FONT,
    lineHeight: LINE_HEIGHT,
    measureAt: (size) => {
      ctx.font = fontOf(size)
      return (t: string) => ctx.measureText(t).width
    }
  })
  ctx.font = fontOf(fit.size)
  const lineH = fit.size * LINE_HEIGHT
  const blockH = fit.lines.length * lineH
  // 상자 안 세로 가운데 (살짝 위로)
  let y = boxTop + Math.max(0, (boxBottom - boxTop - blockH) * 0.46) + fit.size
  for (const line of fit.lines) {
    if (y > boxBottom + fit.size) break
    drawLine(ctx, line, y, s, pad, boxW)
    y += lineH
  }

  // 출처 — 정렬은 본문과 따로
  if (source) {
    const { x, textAlign } = anchorFor(s.sourceAlign, s.width, pad)
    ctx.globalAlpha = 0.78
    ctx.font = fontOf(Math.round(s.width * 0.03))
    ctx.textAlign = textAlign
    ctx.fillText(`— ${source}`, x, s.height - pad * 0.75)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
