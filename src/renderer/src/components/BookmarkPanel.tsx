import { useState } from 'react'
import { useStore } from '../state/store'
import { addBookmarkAtCurrentPage, setOutline } from '../lib/actions'
import { indentAt, moveAt, outdentAt, removeAt, renameAt, type Path } from '../lib/bookmarks'
import type { BookmarkItem } from '../../../shared/types'

function Node({
  item,
  path,
  depth,
  editing,
  setEditing
}: {
  item: BookmarkItem
  path: Path
  depth: number
  editing: string | null
  setEditing: (key: string | null) => void
}): React.JSX.Element {
  const info = useStore((s) => s.info)
  const set = useStore((s) => s.set)
  const key = path.join('.')
  const [draft, setDraft] = useState(item.title)
  const tree = info?.outline ?? []

  const commit = (): void => {
    setEditing(null)
    const title = draft.trim()
    if (title && title !== item.title) void setOutline(renameAt(tree, path, title))
  }

  return (
    <>
      <div className="bm-row" style={{ paddingLeft: 8 + depth * 16 }}>
        {editing === key ? (
          <input
            className="bm-edit"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <span
            className="bm-title"
            onClick={() => useStore.getState().gotoPage(item.page)}
            onDoubleClick={() => {
              setDraft(item.title)
              setEditing(key)
            }}
            title={`${item.page + 1}쪽으로 이동 (더블클릭: 이름 변경)`}
          >
            {item.title}
          </span>
        )}
        <span className="bm-page">{item.page + 1}</span>
        <span className="bm-tools">
          <button title="위로" onClick={() => void setOutline(moveAt(tree, path, -1))}>▲</button>
          <button title="아래로" onClick={() => void setOutline(moveAt(tree, path, 1))}>▼</button>
          <button title="하위로" onClick={() => void setOutline(indentAt(tree, path))}>→</button>
          <button title="상위로" onClick={() => void setOutline(outdentAt(tree, path))}>←</button>
          <button title="삭제" onClick={() => void setOutline(removeAt(tree, path))}>✕</button>
        </span>
      </div>
      {item.children.map((child, i) => (
        <Node
          key={`${key}.${i}`}
          item={child}
          path={[...path, i]}
          depth={depth + 1}
          editing={editing}
          setEditing={setEditing}
        />
      ))}
    </>
  )
}

export default function BookmarkPanel(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const [editing, setEditing] = useState<string | null>(null)
  if (!info) return <div />

  return (
    <div className="bm-panel">
      <div className="bm-header">
        <button onClick={() => void addBookmarkAtCurrentPage()} title="Ctrl+B">
          + 현재 페이지 책갈피
        </button>
      </div>
      {info.outline.length === 0 && (
        <p className="bm-empty">
          책갈피가 없습니다.
          <br />
          Ctrl+B로 현재 페이지를 추가하세요.
        </p>
      )}
      {info.outline.map((item, i) => (
        <Node key={i} item={item} path={[i]} depth={0} editing={editing} setEditing={setEditing} />
      ))}
    </div>
  )
}
