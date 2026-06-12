/** 캔버스 기반 이미지 변형 — 자유 회전·반전·종횡비 보정 PNG 생성 (#C) */

function loadImage(data: ArrayBuffer): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('이미지 로드 실패'))
    }
    img.src = url
  })
}

export async function imageNaturalSize(data: ArrayBuffer): Promise<{ width: number; height: number }> {
  const img = await loadImage(data.slice(0))
  return { width: img.naturalWidth, height: img.naturalHeight }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG 변환 실패'))
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

/** 회전된 사각형 [w,h]의 축정렬 바운딩박스 크기 */
export function rotatedBBox(w: number, h: number, deg: number): { W: number; H: number } {
  const r = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  return { W: w * c + h * s, H: w * s + h * c }
}

/**
 * 원본을 표시 종횡비(dispW:dispH)로 늘린 뒤 angle만큼 회전·반전한 PNG.
 * 결과 PNG의 바운딩박스 종횡비 = rotatedBBox(dispW,dispH,angle) 와 동일 → rect에 맞춰도 전단(shear) 없음.
 */
export async function transformPng(
  origData: ArrayBuffer,
  angleDeg: number,
  flipH: boolean,
  flipV: boolean,
  dispW: number,
  dispH: number
): Promise<ArrayBuffer> {
  const img = await loadImage(origData.slice(0))
  const base = Math.max(img.naturalWidth, img.naturalHeight, 1)
  // 표시 종횡비로 늘린 중간 크기 (해상도 유지)
  let bw: number
  let bh: number
  if (dispW >= dispH) {
    bw = base
    bh = Math.max(1, Math.round((base * dispH) / dispW))
  } else {
    bh = base
    bw = Math.max(1, Math.round((base * dispW) / dispH))
  }
  const { W, H } = rotatedBBox(bw, bh, angleDeg)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((angleDeg * Math.PI) / 180)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh)
  return canvasToPng(canvas)
}
