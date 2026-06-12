import { useEffect } from 'react'
import { useStore } from '../state/store'
import Icon from './Icon'
import { SUPPORT_QR } from '../assets/qr'

const URL = 'https://buymeacoffee.com/icenovel'

/** 후원 모달 — Buy Me a Coffee 링크 + QR */
export default function SupportModal(): React.JSX.Element | null {
  const show = useStore((s) => s.showSupport)
  const set = useStore((s) => s.set)

  useEffect(() => {
    if (!show) return
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') set({ showSupport: false })
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [show, set])

  if (!show) return null

  return (
    <div className="modal-backdrop" onMouseDown={() => set({ showSupport: false })}>
      <div className="support-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={() => set({ showSupport: false })} title="닫기">
          <Icon name="x" size={16} />
        </button>
        <h2>ICEPDF</h2>
        <p className="support-sub">아크로벳 스타일 PDF 뷰어 · 편집 · 한글/이미지 변환</p>
        <img className="support-qr" src={SUPPORT_QR} alt="Buy Me a Coffee QR" />
        <p className="support-msg">도움이 되셨다면 커피 한 잔으로 응원해 주세요 ☕</p>
        <button className="support-btn" onClick={() => void window.icepdf.openExternal(URL)}>
          ☕ Buy Me a Coffee
        </button>
        <p className="support-url">{URL}</p>
      </div>
    </div>
  )
}
