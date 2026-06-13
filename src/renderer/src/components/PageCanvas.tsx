import { useEffect, useRef } from 'react'

/**
 * 페이지 비트맵을 캔버스에 디바이스 픽셀(1:1)로 그린다.
 * <img>의 GPU 합성 bilinear 축소 대신 Skia 고품질 리샘플(imageSmoothingQuality:'high')을
 * 써서, 슈퍼샘플 비트맵을 또렷하게 줄인다. 백킹 스토어가 정확히 물리픽셀이라 합성은 1:1.
 */
export default function PageCanvas({
  url,
  cssW,
  cssH
}: {
  url: string
  cssW: number
  cssH: number
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const dw = Math.max(1, Math.round(cssW * dpr))
    const dh = Math.max(1, Math.round(cssH * dpr))
    let cancelled = false
    const img = new Image()
    img.onload = (): void => {
      if (cancelled) return
      canvas.width = dw // 크기 지정은 캔버스를 비우므로 그리기 직전에
      canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, dw, dh)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url, cssW, cssH])

  return <canvas ref={ref} className="page-canvas" style={{ width: cssW, height: cssH }} />
}
