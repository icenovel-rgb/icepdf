import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { closeFind, findStep, setFindQuery } from '../lib/finder'
import { findStatusText } from '../lib/find'
import Icon from './Icon'

/** Ctrl+F 찾기 막대 — 본문 오른쪽 위에 떠 있다. Enter=다음, Shift+Enter=이전, Esc=닫기 */
export default function FindBar(): React.JSX.Element | null {
  const open = useStore((s) => s.findOpen)
  const query = useStore((s) => s.findQuery)
  const status = useStore((s) => s.findStatus)
  const index = useStore((s) => s.findIndex)
  const total = useStore((s) => s.findHits.length)
  const capped = useStore((s) => s.findCapped)
  const focusTick = useStore((s) => s.findFocusTick)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ctrl+F 마다 입력칸 포커스 + 전체 선택 (바로 새 검색어를 칠 수 있게)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open, focusTick])

  if (!open) return null

  const text = findStatusText({ query, status, index, total, capped })
  const none = status === 'done' && total === 0 && !!query.trim()

  return (
    <div className="find-bar" onPointerDown={(e) => e.stopPropagation()}>
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        className={`find-input${none ? ' find-none' : ''}`}
        placeholder="문서에서 찾기"
        spellCheck={false}
        value={query}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            findStep(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            closeFind()
          }
        }}
      />
      <span className={`find-count${none ? ' find-none' : ''}`}>{text}</span>
      <button className="find-btn find-prev" title="이전 결과 (Shift+Enter · Shift+F3)" disabled={!total} onClick={() => findStep(-1)}>
        <Icon name="up" size={15} />
      </button>
      <button className="find-btn find-next" title="다음 결과 (Enter · F3)" disabled={!total} onClick={() => findStep(1)}>
        <Icon name="down" size={15} />
      </button>
      <button className="find-btn find-close" title="닫기 (Esc)" onClick={() => closeFind()}>
        <Icon name="x" size={15} />
      </button>
    </div>
  )
}
