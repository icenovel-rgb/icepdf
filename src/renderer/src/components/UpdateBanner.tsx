import { useStore } from '../state/store'
import Icon from './Icon'

/** 새 버전 알림 카드 — 왼쪽 아래. "다운로드"는 GitHub 릴리스 페이지를 연다 */
export default function UpdateBanner(): React.JSX.Element | null {
  const update = useStore((s) => s.update)
  const current = useStore((s) => s.appVersion)
  const set = useStore((s) => s.set)
  if (!update) return null

  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>새 버전 v{update.version}이 나왔습니다</strong>
        {current && <span className="update-sub">지금 사용 중: v{current}</span>}
      </div>
      <button
        className="update-download"
        onClick={() => {
          void window.icepdf.openExternal(update.url)
          set({ update: null })
        }}
      >
        <Icon name="download" size={15} /> 다운로드
      </button>
      <button className="update-later" title="나중에 (다음 실행 때 다시 알림)" onClick={() => set({ update: null })}>
        나중에
      </button>
    </div>
  )
}
