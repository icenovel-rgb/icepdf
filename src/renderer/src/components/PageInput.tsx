/**
 * 툴바 쪽 번호 입력칸 — 전체 쪽 수의 자릿수만큼 넓어져 세 자리·네 자리도 잘리지 않는다.
 * 숫자를 치고 Enter로 이동한다(치는 도중 1쪽·12쪽으로 튀지 않게). 범위 밖이거나 포커스가 빠지면
 * 현재 쪽 번호로 돌아온다. ↑/↓는 바로 다음·이전 쪽.
 */
import { useState } from 'react'
import { useStore } from '../state/store'

/** 숫자 자릿수 → 입력칸 폭 (좌우 안쪽 여백·테두리 포함) */
export function pageInputWidth(pageCount: number): string {
  const digits = Math.max(2, String(Math.max(1, pageCount)).length)
  return `calc(${digits}ch + 20px)`
}

export default function PageInput(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const currentPage = useStore((s) => s.currentPage)
  const gotoPage = useStore((s) => s.gotoPage)
  const [draft, setDraft] = useState<string | null>(null)
  const count = info?.pageCount ?? 0

  const commit = (el: HTMLInputElement): void => {
    const page = Number(draft) - 1
    if (draft && page >= 0 && page < count) gotoPage(page)
    setDraft(null)
    el.blur()
  }
  const step = (delta: number): void => {
    setDraft(null)
    gotoPage(Math.max(0, Math.min(count - 1, currentPage + delta)))
  }

  return (
    <input
      className="tb-page"
      disabled={!info}
      type="text"
      inputMode="numeric"
      aria-label="쪽 번호"
      title={info ? `쪽 번호 (1–${count}) — 입력 후 Enter` : undefined}
      style={{ width: pageInputWidth(count) }}
      value={draft ?? (info ? String(currentPage + 1) : '')}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 7))}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget)
        else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          step(e.key === 'ArrowUp' ? 1 : -1)
        }
      }}
    />
  )
}
