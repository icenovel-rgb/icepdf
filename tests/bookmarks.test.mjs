/**
 * 책갈피 트리 유틸 단위 테스트 — tsx 로 실제 모듈을 직접 임포트해 검증.
 * 실행: npx tsx tests/bookmarks.test.mjs
 */
import assert from 'node:assert/strict'
import {
  flatten,
  removeRefs,
  sortByPage,
  moveNodes,
  getAt
} from '../src/renderer/src/lib/bookmarks.ts'

const bm = (title, page, children = []) => ({ title, page, children })
let passed = 0
const ok = (name) => {
  passed++
  console.log(`  ✓ ${name}`)
}

// 공통 픽스처:  A(p2) [ A1(p5), A2(p1) ],  B(p0),  C(p9)
const fixture = () => [
  bm('A', 2, [bm('A1', 5), bm('A2', 1)]),
  bm('B', 0),
  bm('C', 9)
]

// ── flatten ──
{
  const f = flatten(fixture())
  assert.deepEqual(
    f.map((n) => n.item.title),
    ['A', 'A1', 'A2', 'B', 'C']
  )
  assert.deepEqual(f.map((n) => n.depth), [0, 1, 1, 0, 0])
  assert.deepEqual(f[1].path, [0, 0])
  assert.deepEqual(f[2].path, [0, 1])
  ok('flatten: 깊이우선 순서 + depth + path')
}

// ── sortByPage: 형제끼리 페이지 오름차순, 계층 보존 ──
{
  const sorted = sortByPage(fixture())
  assert.deepEqual(
    sorted.map((n) => n.title),
    ['B', 'A', 'C']
  ) // 0, 2, 9
  assert.deepEqual(
    sorted[1].children.map((n) => n.title),
    ['A2', 'A1']
  ) // 1, 5
  ok('sortByPage: 형제 정렬 + 하위까지 재귀')
}

// 안정 정렬: 같은 페이지면 원래 순서 유지
{
  const sorted = sortByPage([bm('X', 3), bm('Y', 3), bm('Z', 1)])
  assert.deepEqual(sorted.map((n) => n.title), ['Z', 'X', 'Y'])
  ok('sortByPage: 동일 페이지 안정성')
}

// ── removeRefs: 다중 삭제 + 부모 삭제 시 하위 동반 ──
{
  const tree = fixture()
  const a = tree[0] // 하위 A1,A2 포함
  const c = tree[2]
  const out = removeRefs(tree, new Set([a, c]))
  assert.deepEqual(flatten(out).map((n) => n.item.title), ['B'])
  ok('removeRefs: 부모 삭제 시 하위 동반 + 다중 삭제')
}
{
  // 자식만 삭제
  const tree = fixture()
  const a1 = tree[0].children[0]
  const out = removeRefs(tree, new Set([a1]))
  assert.deepEqual(flatten(out).map((n) => n.item.title), ['A', 'A2', 'B', 'C'])
  ok('removeRefs: 하위 노드만 삭제')
}

// ── moveNodes: 순서 변경 ──
{
  // C 를 A 앞으로
  const tree = fixture()
  const c = tree[2]
  const out = moveNodes(tree, new Set([c]), tree[0], 'before')
  assert.deepEqual(out.map((n) => n.title), ['C', 'A', 'B'])
  // A 의 하위는 그대로
  assert.deepEqual(getAt(out, [1]).children.map((n) => n.title), ['A1', 'A2'])
  ok('moveNodes: 루트 형제 before 이동 (하위 보존)')
}
{
  // B 를 A 의 하위(A1 뒤)로 재부모화
  const tree = fixture()
  const b = tree[1]
  const a1 = tree[0].children[0]
  const out = moveNodes(tree, new Set([b]), a1, 'after')
  assert.deepEqual(out.map((n) => n.title), ['A', 'C'])
  assert.deepEqual(getAt(out, [0]).children.map((n) => n.title), ['A1', 'B', 'A2'])
  ok('moveNodes: 다른 노드 하위로 재부모화')
}
{
  // 다중 이동: B,C 를 A1 앞으로 (화면 순서 유지)
  const tree = fixture()
  const out = moveNodes(tree, new Set([tree[1], tree[2]]), tree[0].children[0], 'before')
  assert.deepEqual(out.map((n) => n.title), ['A'])
  assert.deepEqual(getAt(out, [0]).children.map((n) => n.title), ['B', 'C', 'A1', 'A2'])
  ok('moveNodes: 다중 노드 이동 (순서 유지)')
}
{
  // target=null → 루트 끝
  const tree = fixture()
  const out = moveNodes(tree, new Set([tree[0]]), null, 'after')
  assert.deepEqual(out.map((n) => n.title), ['B', 'C', 'A'])
  ok('moveNodes: target=null → 루트 끝으로')
}
{
  // 자기 자신 위로 드롭 → 무변경
  const tree = fixture()
  const out = moveNodes(tree, new Set([tree[0]]), tree[0], 'before')
  assert.equal(out, tree)
  ok('moveNodes: 자기 자신 드롭 무시')
}
{
  // 자기 하위로 드롭 → 무변경 (노드 유실 방지)
  const tree = fixture()
  const a = tree[0]
  const a1 = a.children[0]
  const out = moveNodes(tree, new Set([a]), a1, 'after')
  assert.equal(out, tree)
  ok('moveNodes: 자기 하위로 드롭 무시 (유실 방지)')
}
{
  // 불변성: 원본 트리 미변경
  const tree = fixture()
  const snapshot = JSON.stringify(tree)
  moveNodes(tree, new Set([tree[2]]), tree[0], 'before')
  removeRefs(tree, new Set([tree[1]]))
  sortByPage(tree)
  assert.equal(JSON.stringify(tree), snapshot)
  ok('불변성: 원본 트리 미변경')
}

console.log(`\n책갈피 유틸 테스트 ${passed}개 모두 통과`)
