/**
 * 글자를 선택하면 그 위에 뜨는 작은 막대 — 색을 누르면 바로 밑줄(형광펜),
 * 형광/밑줄 전환, 복사, 문장 카드 만들기. PDF·EPUB 공용.
 */
import { useStore } from '../state/store'
import Icon from './Icon'
import { copySelection } from '../lib/actions'
import { addNoteFromSelection, openCard } from '../lib/reading'
import { NOTE_COLORS } from '../../../shared/reading'
import type { Quad } from '../../../shared/types'

interface Props {
  quads: Quad[]
  zoom: number
  /** 쪽 폭(px) — 막대가 쪽 밖으로 나가지 않게 */
  pageWidth: number
}

const BAR_WIDTH = 286
const BAR_HEIGHT = 36
const GAP = 8

function bounds(quads: Quad[]): { top: number; bottom: number; left: number } {
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]])
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]])
  return { top: Math.min(...ys), bottom: Math.max(...ys), left: Math.min(...xs) }
}

export default function SelectionPopup({ quads, zoom, pageWidth }: Props): React.JSX.Element | null {
  const style = useStore((s) => s.highlightStyle)
  const text = useStore((s) => s.selection?.text ?? '')
  const set = useStore((s) => s.set)
  if (!quads.length || !text.trim()) return null

  const b = bounds(quads)
  // 선택 위쪽에 띄우고, 쪽 맨 위라 공간이 없으면 아래쪽에
  const above = b.top * zoom - BAR_HEIGHT - GAP
  const top = above >= 0 ? above : b.bottom * zoom + GAP
  const left = Math.max(4, Math.min(pageWidth - BAR_WIDTH - 4, b.left * zoom))

  return (
    <div
      className="sel-popup"
      style={{ top, left }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          className={`sel-swatch ${style}`}
          style={{ ['--swatch' as string]: c }}
          title={style === 'underline' ? '이 색으로 밑줄' : '이 색으로 형광펜'}
          onClick={() => void addNoteFromSelection(c, style)}
        />
      ))}
      <span className="sel-sep" />
      <button
        className={`sel-btn ${style === 'underline' ? 'active' : ''}`}
        title={style === 'underline' ? '밑줄 모드 (누르면 형광펜)' : '형광펜 모드 (누르면 밑줄)'}
        onClick={() => set({ highlightStyle: style === 'underline' ? 'highlight' : 'underline' })}
      >
        <Icon name="underline" size={16} />
      </button>
      <button className="sel-btn" title="복사 (Ctrl+C)" onClick={() => void copySelection()}>
        <Icon name="copy" size={16} />
      </button>
      <button className="sel-btn sel-card" title="문장 카드 이미지 만들기" onClick={() => openCard(text)}>
        <Icon name="quote" size={16} />
      </button>
    </div>
  )
}
