/** 윈도우 탐색기 스타일 탭 바 — 한 창에서 여러 문서 전환 */
import { useStore } from '../state/store'
import { closeTabById, openFile } from '../lib/actions'
import Icon from './Icon'

export default function TabBar(): React.JSX.Element | null {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  // 활성 탭의 제목/dirty는 라이브 스토어가 진실 (snapshot은 비활성 탭용)
  const liveInfo = useStore((s) => s.info)
  const liveDirty = useStore((s) => s.dirty)
  const switchTab = useStore((s) => s.switchTab)

  if (tabs.length === 0) return null

  return (
    <div className="tab-bar">
      {tabs.map((t) => {
        const active = t.id === activeTabId
        const title = (active ? liveInfo?.title : t.snapshot.info?.title) ?? '문서'
        const dirty = active ? liveDirty : t.snapshot.dirty
        return (
          <div
            key={t.id}
            className={`tab ${active ? 'active' : ''}`}
            title={title}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void closeTabById(t.id)
              } else if (e.button === 0) {
                switchTab(t.id)
              }
            }}
          >
            {dirty && <span className="tab-dot" />}
            <span className="tab-title">{title}</span>
            <button
              className="tab-close"
              title="탭 닫기 (Ctrl+W)"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void closeTabById(t.id)
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )
      })}
      <button className="tab-new" title="새 탭 (Ctrl+T)" onClick={() => void openFile()}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  )
}
