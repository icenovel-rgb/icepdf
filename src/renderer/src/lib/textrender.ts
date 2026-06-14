/**
 * 텍스트 → 투명 배경 PNG 렌더링 (텍스트 추가 툴).
 *
 * mupdf.js의 기본 14폰트는 한글을 그리지 못하므로, 브라우저 캔버스로
 * 시스템 폰트(맑은 고딕 등)를 직접 렌더해 Stamp 주석 이미지로 삽입한다.
 * 선명도를 위해 포인트 크기의 SS배 픽셀로 그린 뒤 포인트 좌표를 함께 반환한다.
 */

/** 화면/엔진 좌표는 포인트(pt), 캔버스는 그 SS배 픽셀로 그려 축소 시에도 선명 */
const SS = 4
/** 글자 잘림 방지용 여백 — 폰트 크기에 비례(크기 바꿔도 박스 종횡비 일정 → 비례 스케일) */
const PAD_RATIO = 0.12
const LINE_HEIGHT = 1.32

export interface TextStyle {
  /** CSS font-family (예: 'Malgun Gothic') */
  font: string
  /** 글자 크기 (pt) */
  size: number
  /** '#rrggbb' */
  color: string
}

export interface RenderedText {
  png: ArrayBuffer
  /** 삽입 사각형 크기 (pt) */
  widthPt: number
  heightPt: number
}

function cssFont(style: TextStyle, px: number): string {
  // font-family에 공백이 있으면 따옴표로 감싼다
  const family = /[",\s]/.test(style.font) ? `"${style.font.replace(/"/g, '')}"` : style.font
  return `${px}px ${family}, 'Segoe UI', sans-serif`
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG 변환 실패'))
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

/**
 * 여러 줄 텍스트를 투명 PNG로 렌더링한다.
 * @returns png 바이너리 + 포인트 단위 박스 크기 (PAD 여백 포함)
 */
export async function renderTextToPng(text: string, style: TextStyle): Promise<RenderedText> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sizePx = Math.max(1, style.size) * SS
  const lineHeightPx = sizePx * LINE_HEIGHT

  // 1차 측정용 캔버스
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = cssFont(style, sizePx)
  let maxWidthPx = 0
  for (const line of lines) {
    maxWidthPx = Math.max(maxWidthPx, measure.measureText(line || ' ').width)
  }

  const padPx = Math.max(2, sizePx * PAD_RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(maxWidthPx + padPx * 2))
  canvas.height = Math.max(1, Math.ceil(lineHeightPx * lines.length + padPx * 2))

  const ctx = canvas.getContext('2d')!
  ctx.font = cssFont(style, sizePx)
  ctx.fillStyle = style.color
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  // 약간의 들여쓰기 보정으로 좌측 글자가 잘리지 않게
  lines.forEach((line, i) => {
    ctx.fillText(line, padPx, padPx + i * lineHeightPx + (lineHeightPx - sizePx) / 2)
  })

  const png = await canvasToPng(canvas)
  return {
    png,
    widthPt: canvas.width / SS,
    heightPt: canvas.height / SS
  }
}
