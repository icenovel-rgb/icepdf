import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { addBookmarkAtCurrentPage, setOutline } from '../lib/actions'
import {
  flatten,
  getAt,
  indentAt,
  moveNodes,
  outdentAt,
  removeRefs,
  renameAt,
  sortByPage,
  type FlatNode,
  type Path
} from '../lib/bookmarks'
import type { BookmarkItem } from '../../../shared/types'

const keyOf = (path: Path): string => path.join('.')
const pathOf = (key: string): Path => key.split('.').map(Number)

type DropMark = { key: string; where: 'before' | 'after' } | null

export default function BookmarkPanel(): React.JSX.Element {
  const info = useStore((s) => s.info)
  const tree = info?.outline ?? []
  const flat = flatten(tree)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dropMark, setDropMark] = useState<DropMark>(null)
  const [rootOver, setRootOver] = useState(false)
  // 드래그 중인 행 key 집합 (dragstart→drop 사이 유지, 리렌더 불필요해 ref 사용)
  const dragKeys = useRef<Set<string>>(new Set())

  if (!info) return <div />

  /** 구조가 바뀌는 변경 — 선택/앵커는 path 기준이라 무효화되므로 비운다 */
  const applyStructural = (next: BookmarkItem[]): void => {
    setSelected(new Set())
    setAnchor(null)
    setDropMark(null)
    void setOutline(next)
  }

  const refsFromKeys = (keys: Iterable<string>): Set<BookmarkItem> => {
    const refs = new Set<BookmarkItem>()
    for (const k of keys) {
      const node = getAt(tree, pathOf(k))
      if (node) refs.add(node)
    }
    return refs
  }

  const onTitleClick = (e: React.MouseEvent, f: FlatNode): void => {
    const key = keyOf(f.path)
    if (e.shiftKey && anchor) {
      const ai = flat.findIndex((x) => keyOf(x.path) === anchor)
      const bi = flat.findIndex((x) => keyOf(x.path) === key)
      if (ai >= 0 && bi >= 0) {
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai]
        const range = new Set<string>()
        for (let i = lo; i <= hi; i++) range.add(keyOf(flat[i].path))
        setSelected(range)
      }
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setSelected(next)
      setAnchor(key)
    } else {
      // 일반 클릭: 해당 쪽으로 이동 + 단일 선택(앵커 설정)
      setSelected(new Set([key]))
      setAnchor(key)
      useStore.getState().gotoPage(f.item.page)
    }
  }

  const startEdit = (f: FlatNode): void => {
    setDraft(f.item.title)
    setEditing(keyOf(f.path))
  }

  const commitEdit = (f: FlatNode): void => {
    setEditing(null)
    const title = draft.trim()
    if (title && title !== f.item.title) void setOutline(renameAt(tree, f.path, title))
  }

  const deleteSelected = (): void => {
    if (selected.size === 0) return
    applyStructural(removeRefs(tree, refsFromKeys(selected)))
  }

  // ── 드래그 순서 변경 ──
  const onDragStart = (e: React.DragEvent, f: FlatNode): void => {
    const key = keyOf(f.path)
    // 선택된 행을 끌면 선택 전체, 아니면 그 행만 (선택도 그 행으로 맞춤)
    if (selected.has(key)) {
      dragKeys.current = new Set(selected)
    } else {
      dragKeys.current = new Set([key])
      setSelected(new Set([key]))
      setAnchor(key)
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }

  const onRowDragOver = (e: React.DragEvent, f: FlatNode): void => {
    if (dragKeys.current.size === 0) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const where = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setRootOver(false)
    setDropMark({ key: keyOf(f.path), where })
  }

  const onRowDrop = (e: React.DragEvent, f: FlatNode): void => {
    if (dragKeys.current.size === 0) return // 외부 파일 드롭 등은 App 의 열기 핸들러로
    e.preventDefault()
    const mark = dropMark
    const refs = refsFromKeys(dragKeys.current) // endDrag() 전에 캡처 (endDrag 가 dragKeys 를 비움)
    endDrag()
    if (!mark || refs.size === 0) return
    const targetNode = getAt(tree, f.path)
    if (!targetNode || refs.has(targetNode)) return
    applyStructural(moveNodes(tree, refs, targetNode, mark.where))
  }

  const onRootDrop = (e: React.DragEvent): void => {
    if (dragKeys.current.size === 0) return // 외부 파일 드롭은 무시
    e.preventDefault()
    const refs = refsFromKeys(dragKeys.current)
    endDrag()
    if (refs.size === 0) return
    applyStructural(moveNodes(tree, refs, null, 'after'))
  }

  const endDrag = (): void => {
    dragKeys.current = new Set()
    setDropMark(null)
    setRootOver(false)
  }

  return (
    <div className="bm-panel">
      <div className="bm-header">
        <button onClick={() => void addBookmarkAtCurrentPage()} title="Ctrl+B">
          + 현재 페이지 책갈피
        </button>
        <div className="bm-actions">
          <button onClick={() => applyStructural(sortByPage(tree))} disabled={tree.length === 0} title="페이지 번호 순으로 정렬">
            페이지순 정렬
          </button>
          <button onClick={deleteSelected} disabled={selected.size === 0} title="선택한 책갈피 삭제">
            선택 삭제{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>

      {tree.length === 0 ? (
        <p className="bm-empty">
          책갈피가 없습니다.
          <br />
          Ctrl+B로 현재 페이지를 추가하세요.
        </p>
      ) : (
        <>
          <p className="bm-hint">클릭=이동 · Shift/Ctrl+클릭=다중 선택 · 드래그=순서 변경</p>
          {flat.map((f) => {
            const key = keyOf(f.path)
            const isSel = selected.has(key)
            const mark = dropMark?.key === key ? dropMark.where : null
            const cls =
              'bm-row' +
              (isSel ? ' bm-row--sel' : '') +
              (mark === 'before' ? ' bm-row--drop-before' : '') +
              (mark === 'after' ? ' bm-row--drop-after' : '')
            return (
              <div
                key={key}
                className={cls}
                style={{ paddingLeft: 8 + f.depth * 16 }}
                draggable={editing !== key}
                onDragStart={(e) => onDragStart(e, f)}
                onDragOver={(e) => onRowDragOver(e, f)}
                onDrop={(e) => onRowDrop(e, f)}
                onDragEnd={endDrag}
              >
                {editing === key ? (
                  <input
                    className="bm-edit"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(f)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(f)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span
                    className="bm-title"
                    onClick={(e) => onTitleClick(e, f)}
                    onDoubleClick={() => startEdit(f)}
                    title={`${f.item.page + 1}쪽으로 이동 (더블클릭: 이름 변경)`}
                  >
                    {f.item.title}
                  </span>
                )}
                <span className="bm-page">{f.item.page + 1}</span>
                <span className="bm-tools" draggable={false}>
                  <button title="하위로" onClick={() => applyStructural(indentAt(tree, f.path))}>→</button>
                  <button title="상위로" onClick={() => applyStructural(outdentAt(tree, f.path))}>←</button>
                </span>
              </div>
            )
          })}
          <div
            className={`bm-droproot${rootOver ? ' bm-droproot--over' : ''}`}
            onDragOver={(e) => {
              if (dragKeys.current.size === 0) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropMark(null)
              setRootOver(true)
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={onRootDrop}
          />
        </>
      )}
    </div>
  )
}
