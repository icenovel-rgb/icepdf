/**
 * EPUB 본문 글꼴 고르기 (툴바) — 설치된 한글 글꼴 중 추천 글꼴을 위에, 나머지는 아래 묶음에.
 * 글꼴은 앱 전역이라 열린 EPUB 탭 전체에 적용되고 다음 실행에도 유지된다.
 */
import { useEffect } from 'react'
import { useStore } from '../state/store'
import { loadReadingFonts, setEpubFont } from '../lib/reading'

export default function EpubFontSelect(): React.JSX.Element {
  const epubFont = useStore((s) => s.epubFont)
  const fonts = useStore((s) => s.readingFonts)

  useEffect(() => {
    void loadReadingFonts()
  }, [])

  const recommended = fonts?.filter((f) => f.recommended) ?? []
  const others = fonts?.filter((f) => !f.recommended) ?? []
  // 목록을 불러오기 전이거나 지워진 글꼴이어도 지금 값은 보이게
  const missing = epubFont && !fonts?.some((f) => f.id === epubFont)

  return (
    <select
      className="tb-epub-font"
      value={epubFont}
      onChange={(e) => {
        // 고른 뒤 포커스를 빼 둔다 — 방향키가 글꼴을 연달아 바꾸며 쪽을 계속 다시 나누지 않게
        e.currentTarget.blur()
        void setEpubFont(e.target.value)
      }}
      title="EPUB 본문 글꼴 — 열린 EPUB 전체에 적용"
    >
      <option value="">책 기본 글꼴</option>
      {missing && <option value={epubFont}>{epubFont}</option>}
      {fonts === null && <option disabled>글꼴 찾는 중…</option>}
      {recommended.length > 0 && (
        <optgroup label="추천">
          {recommended.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="설치된 한글 글꼴">
          {others.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
