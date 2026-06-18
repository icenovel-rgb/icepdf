/** 책갈피 트리 불변 변환 유틸. path = 루트부터의 인덱스 배열 */
import type { BookmarkItem } from '../../../shared/types'

export type Path = number[]

/** 화면 표시 순서(깊이우선)로 평탄화한 노드 — 다중 선택·드래그·정렬에 사용 */
export interface FlatNode {
  item: BookmarkItem
  path: Path
  depth: number
}

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

/** 트리를 화면 표시 순서대로 펼친다 (깊이우선). 다중 선택 범위·드래그 계산에 사용 */
export function flatten(items: BookmarkItem[], depth = 0, prefix: Path = []): FlatNode[] {
  const out: FlatNode[] = []
  items.forEach((item, i) => {
    const path = [...prefix, i]
    out.push({ item, path, depth })
    out.push(...flatten(item.children, depth + 1, path))
  })
  return out
}

/** 참조로 지정한 노드들(과 그 하위 전체)을 트리에서 제거 — 다중 삭제용 */
export function removeRefs(items: BookmarkItem[], refs: Set<BookmarkItem>): BookmarkItem[] {
  return items
    .filter((it) => !refs.has(it))
    .map((it) => ({ ...it, children: removeRefs(it.children, refs) }))
}

/** 형제끼리 페이지 번호 오름차순으로 안정 정렬 (계층 구조는 보존, 재귀) */
export function sortByPage(items: BookmarkItem[]): BookmarkItem[] {
  return [...items]
    .sort((a, b) => a.page - b.page)
    .map((it) => ({ ...it, children: sortByPage(it.children) }))
}

/**
 * dragged 노드들을 target 기준 where('before'|'after') 위치로 옮긴다 (드래그 순서 변경).
 * - 선택된 부모와 그 하위가 함께 dragged 에 있으면 부모만 통째로 이동(하위는 따라감).
 * - target=null 이면 루트 맨 끝으로 이동.
 * - target 이 dragged 자신이거나 그 하위면 이동 불가 → 원본을 그대로 반환.
 */
export function moveNodes(
  items: BookmarkItem[],
  dragged: Set<BookmarkItem>,
  target: BookmarkItem | null,
  where: 'before' | 'after'
): BookmarkItem[] {
  if (target && dragged.has(target)) return items

  // 이동할 최상위 노드들을 화면 순서대로 수집 (dragged 안에서 더 깊은 건 제외 — 부모와 동행)
  const collect = (list: BookmarkItem[]): BookmarkItem[] =>
    list.flatMap((it) => (dragged.has(it) ? [it] : collect(it.children)))
  const moved = collect(items)
  if (moved.length === 0) return items

  let inserted = false
  const rebuild = (list: BookmarkItem[]): BookmarkItem[] => {
    const out: BookmarkItem[] = []
    for (const it of list) {
      if (it === target && where === 'before') {
        out.push(...moved)
        inserted = true
      }
      if (!dragged.has(it)) {
        out.push({ ...it, children: rebuild(it.children) })
      }
      if (it === target && where === 'after') {
        out.push(...moved)
        inserted = true
      }
    }
    return out
  }

  const result = rebuild(items)
  if (target === null) return [...result, ...moved]
  // target 이 dragged 하위라 rebuild 가 닿지 못했으면 이동 취소(노드 유실 방지)
  return inserted ? result : items
}
