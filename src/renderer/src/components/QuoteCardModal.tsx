/**
 * 문장 카드 편집 창 — 배경(이미지 8장 + 단색)·비율·글꼴·크기·정렬·글자색·막·출처를 고르면
 * 미리보기가 바로 바뀌고, PNG로 저장하거나 클립보드에 복사한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { CARD_RATIOS, cardSize, drawCard, type CardAlign, type CardRatio } from '../lib/quote-card'
import { CARD_BACKGROUNDS, availableCardFonts } from '../lib/card-presets'

/** 배경 이미지 캐시 — 창을 다시 열어도 다시 내려받지 않게 */
const images = new Map<string, HTMLImageElement>()

function loadImage(src: string, onReady: () => void): HTMLImageElement {
  const cached = images.get(src)
  if (cached) return cached
  const img = new Image()
  img.onload = onReady
  img.src = src
  images.set(src, img)
  return img
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('이미지를 만들지 못했습니다'))
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

export default function QuoteCardModal(): React.JSX.Element | null {
  const draft = useStore((s) => s.cardDraft)
  const set = useStore((s) => s.set)
  const showToast = useStore((s) => s.showToast)
  const fonts = useMemo(() => (draft ? availableCardFonts() : []), [!!draft])

  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [bgId, setBgId] = useState(CARD_BACKGROUNDS[0].id)
  const [ratio, setRatio] = useState<CardRatio>('4:5')
  const [font, setFont] = useState('Batang')
  const [fontSize, setFontSize] = useState(60)
  const [align, setAlign] = useState<CardAlign>('left')
  const [ink, setInk] = useState(CARD_BACKGROUNDS[0].ink)
  const [shade, setShade] = useState(CARD_BACKGROUNDS[0].shade)
  const [loaded, setLoaded] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 새 문장으로 열릴 때 내용만 바꾸고 고른 꾸밈은 유지
  useEffect(() => {
    if (!draft) return
    setText(draft.text)
    setSource(draft.source ? `『${draft.source}』` : '')
  }, [draft])

  const bg = CARD_BACKGROUNDS.find((b) => b.id === bgId) ?? CARD_BACKGROUNDS[0]

  useEffect(() => {
    if (!draft) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { width, height } = cardSize(ratio)
    canvas.width = width
    canvas.height = height
    const img = bg.src ? loadImage(bg.src, () => setLoaded((n) => n + 1)) : null
    const ready = img && img.complete && img.naturalWidth > 0
    drawCard(ctx, {
      width,
      height,
      image: ready ? img : null,
      imageSize: ready ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      color: bg.color,
      shade,
      ink,
      font,
      maxFontSize: fontSize,
      align,
      text,
      source
    })
  }, [draft, text, source, bg, ratio, font, fontSize, align, ink, shade, loaded])

  if (!draft) return null

  const close = (): void => set({ cardDraft: null })
  const pickBg = (id: string): void => {
    const next = CARD_BACKGROUNDS.find((b) => b.id === id)
    if (!next) return
    setBgId(id)
    setInk(next.ink)
    setShade(next.shade)
  }
  const save = async (): Promise<void> => {
    if (!canvasRef.current) return
    try {
      const png = await canvasToPng(canvasRef.current)
      const name = (draft.source || '문장').replace(/[\\/:*?"<>|]/g, '_')
      const path = await window.icepdf.saveBinaryFile(
        { title: '문장 카드 저장', defaultPath: `${name} 문장 카드.png`, ext: 'png', extName: 'PNG 이미지' },
        png
      )
      if (path) showToast(`문장 카드를 저장했습니다: ${path}`)
    } catch (err) {
      showToast(`저장 실패: ${err instanceof Error ? err.message : err}`)
    }
  }
  const copy = async (): Promise<void> => {
    if (!canvasRef.current) return
    try {
      await window.icepdf.copyImage(await canvasToPng(canvasRef.current))
      showToast('문장 카드를 클립보드에 복사했습니다')
    } catch (err) {
      showToast(`복사 실패: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div className="modal-backdrop card-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="card-modal"
        role="dialog"
        aria-label="문장 카드 만들기"
        onKeyDown={(e) => {
          e.stopPropagation() // 뒤 문서 단축키(Delete·Tab 등)로 새지 않게
          if (e.key === 'Escape') close()
        }}
      >
        <div className="card-preview">
          <canvas ref={canvasRef} className={`card-canvas ratio-${ratio.replace(':', '-')}`} />
        </div>
        <div className="card-controls">
          <h2>문장 카드</h2>
          <label className="card-field">
            <span>문장</span>
            <textarea value={text} rows={5} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          <div className="card-field">
            <span>배경</span>
            <div className="card-bgs">
              {CARD_BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  className={`card-bg ${b.id === bgId ? 'active' : ''}`}
                  title={b.label}
                  style={{ backgroundColor: b.color, backgroundImage: b.src ? `url(${b.src})` : undefined }}
                  onClick={() => pickBg(b.id)}
                />
              ))}
            </div>
          </div>
          <div className="card-field">
            <span>비율</span>
            <div className="card-seg">
              {CARD_RATIOS.map((r) => (
                <button key={r.id} className={r.id === ratio ? 'active' : ''} onClick={() => setRatio(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card-row">
            <label className="card-field">
              <span>글꼴</span>
              <select value={font} onChange={(e) => setFont(e.target.value)}>
                {fonts.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="card-field">
              <span>정렬</span>
              <div className="card-seg">
                <button className={align === 'left' ? 'active' : ''} onClick={() => setAlign('left')}>왼쪽</button>
                <button className={align === 'center' ? 'active' : ''} onClick={() => setAlign('center')}>가운데</button>
              </div>
            </label>
          </div>
          <label className="card-field">
            <span>최대 글자 크기 {fontSize}px <small>(길면 자동으로 줄어듭니다)</small></span>
            <input type="range" min={32} max={110} step={2} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
          </label>
          <div className="card-row">
            <label className="card-field">
              <span>글자색</span>
              <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} />
            </label>
            <label className="card-field card-grow">
              <span>배경 막 {Math.round(shade * 100)}%</span>
              <input type="range" min={0} max={0.7} step={0.02} value={shade} onChange={(e) => setShade(Number(e.target.value))} />
            </label>
          </div>
          <label className="card-field">
            <span>출처</span>
            <input type="text" value={source} placeholder="비우면 출처 없이" onChange={(e) => setSource(e.target.value)} />
          </label>
          <div className="card-actions">
            <button className="primary" onClick={() => void save()}>이미지 저장</button>
            <button onClick={() => void copy()}>클립보드 복사</button>
            <button onClick={close}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  )
}
