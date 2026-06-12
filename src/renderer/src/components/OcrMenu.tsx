import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { ocrAllPages, ocrCurrentPage, ocrPageRange } from '../lib/actions'

interface Props {
  onClose: () => void
}

/** OCR 범위 선택 메뉴 — 현재 페이지 / 범위 / 전체 (#h) */
export default function OcrMenu({ onClose }: Props): React.JSX.Element {
  const info = useStore((s) => s.info)
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState('')
  const [showRange, setShowRange] = useState(false)

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])

  const run = (fn: () => Promise<void>) => (): void => {
    onClose()
    void fn()
  }

  return (
    <div ref={ref} className="ocr-menu">
      <div className="ocr-menu-title">OCR — 글자 인식</div>
      <button onClick={run(ocrCurrentPage)}>현재 페이지</button>
      {!showRange ? (
        <button onClick={() => setShowRange(true)}>페이지 범위 지정...</button>
      ) : (
        <div className="ocr-range">
          <input
            autoFocus
            placeholder="예: 1-5,8"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onClose()
                void ocrPageRange(range)
              }
            }}
          />
          <button
            onClick={() => {
              onClose()
              void ocrPageRange(range)
            }}
          >
            인식
          </button>
        </div>
      )}
      <button onClick={run(ocrAllPages)}>전체 페이지{info ? ` (${info.pageCount}쪽)` : ''}</button>
    </div>
  )
}
