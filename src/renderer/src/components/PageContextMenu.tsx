import { useEffect, useRef } from 'react'
import { deletePageAt, insertBlankAt, insertFromPdfAt } from '../lib/actions'

export interface MenuPos {
  x: number
  y: number
  page: number
}

interface Props {
  pos: MenuPos
  onClose: () => void
}

export default function PageContextMenu({ pos, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const run = (fn: () => Promise<void>) => (): void => {
    onClose()
    void fn()
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }}>
      <div className="ctx-title">{pos.page + 1}쪽</div>
      <button onClick={run(() => insertBlankAt(pos.page))}>위에 빈 페이지 삽입</button>
      <button onClick={run(() => insertBlankAt(pos.page + 1))}>아래에 빈 페이지 삽입</button>
      <button onClick={run(() => insertFromPdfAt(pos.page + 1))}>아래에 PDF에서 삽입...</button>
      <hr />
      <button className="danger" onClick={run(() => deletePageAt(pos.page))}>
        페이지 삭제
      </button>
    </div>
  )
}
