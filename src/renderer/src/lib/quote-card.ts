/**
 * 문장 카드 — 책 속 문장을 배경 위에 얹어 한 장의 이미지로.
 * 줄바꿈·크기 맞춤은 측정 함수를 받는 순수 함수(테스트 가능), 그리기는 Canvas 2D.
 */

export type CardRatio = '1:1' | '4:5' | '9:16'
export type CardAlign = 'left' | 'center'

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

/** 한 덩어리를 글자 단위로 잘라 폭에 맞춘다 (띄어쓰기 없는 긴 한글·URL) */
function breakChars(word: string, maxWidth: number, measure: Measure, lines: string[]): string {
  let line = ''
  for (const ch of word) {
    if (line && measure(line + ch) > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  return line
}

/** 띄어쓰기 우선 줄바꿈 — 문단(줄바꿈)은 유지, 빈 줄은 하나로 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = []
  for (const para of text.trim().split(/\r?\n/)) {
    const words = para.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    if (!words.length) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('')
      continue
    }
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
  }
  return lines
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
export function fitText(text: string, o: FitOptions): { size: number; lines: string[] } {
  for (let size = o.maxSize; size >= o.minSize; size -= 2) {
    const lines = wrapText(text, o.width, o.measureAt(size))
    if (lines.length * size * o.lineHeight <= o.height) return { size, lines }
  }
  return { size: o.minSize, lines: wrapText(text, o.width, o.measureAt(o.minSize)) }
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

/** 카드 한 장을 그린다 */
export function drawCard(ctx: CanvasRenderingContext2D, s: CardSpec): void {
  ctx.save()
  drawBackground(ctx, s)
  const pad = s.width * 0.12
  const boxW = s.width - pad * 2
  const fontOf = (size: number): string => `${size}px "${s.font}", "Malgun Gothic", serif`
  const x = s.align === 'center' ? s.width / 2 : pad
  ctx.textAlign = s.align === 'center' ? 'center' : 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = s.ink

  // 여는 따옴표
  const quoteSize = Math.round(s.width * 0.13)
  ctx.globalAlpha = 0.32
  ctx.font = `${quoteSize}px Georgia, "Times New Roman", serif`
  ctx.fillText('“', x, s.height * 0.12 + quoteSize * 0.75)
  ctx.globalAlpha = 1

  // 본문 — 상자에 맞춰 크기 자동
  const boxTop = s.height * 0.12 + quoteSize * 0.9
  const boxBottom = s.height - pad * 1.35
  const fit = fitText(s.text, {
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
  // 상자 안 세로 가운데 (조금 위로)
  let y = boxTop + Math.max(0, (boxBottom - boxTop - blockH) * 0.42) + fit.size
  for (const line of fit.lines) {
    if (y > boxBottom + fit.size) break
    ctx.fillText(line, x, y)
    y += lineH
  }

  // 출처
  if (s.source.trim()) {
    ctx.globalAlpha = 0.78
    ctx.font = fontOf(Math.round(s.width * 0.03))
    ctx.fillText(`— ${s.source.trim()}`, x, s.height - pad * 0.75)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
