/** 책갈피 트리 불변 변환 유틸. path = 루트부터의 인덱스 배열 */
import type { BookmarkItem } from '../../../shared/types'

export type Path = number[]

function transform(
  items: BookmarkItem[],
  path: Path,
  fn: (siblings: BookmarkItem[], index: number) => BookmarkItem[]
): BookmarkItem[] {
  if (path.length === 1) return fn(items, path[0])
  const [head, ...rest] = path
  return items.map((item, i) =>
    i === head ? { ...item, children: transform(item.children, rest, fn) } : item
  )
}

export function getAt(items: BookmarkItem[], path: Path): BookmarkItem | null {
  let cur: BookmarkItem | undefined
  let list = items
  for (const i of path) {
    cur = list[i]
    if (!cur) return null
    list = cur.children
  }
  return cur ?? null
}

export function renameAt(items: BookmarkItem[], path: Path, title: string): BookmarkItem[] {
  return transform(items, path, (sib, i) =>
    sib.map((b, j) => (j === i ? { ...b, title } : b))
  )
}

export function removeAt(items: BookmarkItem[], path: Path): BookmarkItem[] {
  return transform(items, path, (sib, i) => sib.filter((_, j) => j !== i))
}

export function moveAt(items: BookmarkItem[], path: Path, dir: -1 | 1): BookmarkItem[] {
  return transform(items, path, (sib, i) => {
    const j = i + dir
    if (j < 0 || j >= sib.length) return sib
    const next = [...sib]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
}

/** 들여쓰기: 바로 위 형제의 마지막 자식으로 이동 */
export function indentAt(items: BookmarkItem[], path: Path): BookmarkItem[] {
  return transform(items, path, (sib, i) => {
    if (i === 0) return sib
    const target = sib[i]
    const prev = sib[i - 1]
    const merged = { ...prev, children: [...prev.children, target] }
    return sib.filter((_, j) => j !== i).map((b, j) => (j === i - 1 ? merged : b))
  })
}

/** 내어쓰기: 부모의 다음 형제로 이동 */
export function outdentAt(items: BookmarkItem[], path: Path): BookmarkItem[] {
  if (path.length < 2) return items
  const parentPath = path.slice(0, -1)
  const node = getAt(items, path)
  if (!node) return items
  const withoutChild = transform(items, path, (sib, i) => sib.filter((_, j) => j !== i))
  return transform(withoutChild, parentPath, (sib, i) => {
    const next = [...sib]
    next.splice(i + 1, 0, node)
    return next
  })
}
