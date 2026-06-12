import { useStore } from '../state/store'

export default function StatusBar(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const currentPage = useStore((s) => s.currentPage)
  const zoom = useStore((s) => s.zoom)
  const dirty = useStore((s) => s.dirty)

  return (
    <div className="statusbar">
      <span className="sb-path">{info?.filePath ?? ''}</span>
      <span className="sb-right">
        {dirty && <span className="sb-dirty" title="저장되지 않은 변경">●</span>}
        {info && (
          <>
            <span>{currentPage + 1} / {info.pageCount}쪽</span>
            <span>{Math.round(zoom * 100)}%</span>
          </>
        )}
      </span>
    </div>
  )
}
