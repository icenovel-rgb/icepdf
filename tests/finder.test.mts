/**
 * 찾기 실행기(finder.ts) 경합 검증 — 구간마다 멈출 수 있는 가짜 엔진으로
 * "검색 도중" 사용자 Enter · 문서 변경 · 탭 전환 · 열린 막대에서 Ctrl+F 를 재현한다.
 */
import type { DocInfo, SearchHit } from '../src/shared/types'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}
// setTimeout(0)은 Windows에서 ~15.6ms라 10번이면 디바운스(150ms)를 넘긴다 → setImmediate로 즉시 양보
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await tick()
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ── 가짜 엔진: 문서별 결과 쪽 목록, allow번째 호출 이후는 resume() 전까지 대기 ──
const QUAD = [0, 100, 50, 100, 0, 112, 50, 112]
const hitPages: Record<number, number[]> = {}
let allow = Number.POSITIVE_INFINITY
let calls = 0
const waiters: Array<() => void> = []
async function engine(docId: number, op: string, args: { from: number; to: number; maxHits: number }): Promise<{ hits: SearchHit[] }> {
  if (op !== 'search') throw new Error(`예상 밖 연산 ${op}`)
  // 결과는 요청 시점의 문서 내용으로 계산 — 이미 보낸 요청은 옛 내용 기준으로 돌아온다
  const pages = hitPages[docId] ?? []
  const hits = pages
    .filter((p) => p >= args.from && p < args.to)
    .slice(0, args.maxHits)
    .map((page) => ({ page, quads: [QUAD] }))
  calls++
  if (calls > allow) await new Promise<void>((r) => waiters.push(r))
  return { hits }
}
function pauseAfter(n: number): void {
  calls = 0
  allow = n
}
function resume(): void {
  allow = Number.POSITIVE_INFINITY
  waiters.splice(0).forEach((r) => r())
}

;(globalThis as unknown as { window: unknown }).window = { icepdf: { engine }, getSelection: () => null }
const { useStore } = await import('../src/renderer/src/state/store')
const finder = await import('../src/renderer/src/lib/finder')
const s = (): ReturnType<typeof useStore.getState> => useStore.getState()

const mkInfo = (title: string, pageCount: number): DocInfo => ({
  filePath: null,
  pageCount,
  pages: Array.from({ length: pageCount }, () => ({ width: 600, height: 800 })),
  outline: [],
  title,
  kind: 'pdf',
  fontSize: null
})

const unsubscribe = finder.installFindAutoRerun()

// ── 1. 검색 도중(현재 쪽 이후 결과가 아직 없음) Enter → 앞쪽 결과로 순환 점프하지 않는다 ──
hitPages[1] = [2, 30]
s().openTab(1, mkInfo('a.pdf', 40))
s().set({ currentPage: 20, findOpen: true, findQuery: 'x' })
pauseAfter(1) // 0~11쪽 구간만 응답(2쪽 결과), 다음 구간에서 대기
const run1 = finder.runFind('x', true)
await flush()
check('검색 중: 앞쪽 결과만 도착, 현재 결과 없음', s().findStatus === 'searching' && s().findHits.length === 1 && s().findIndex === -1)
finder.findStep(1)
await flush()
check('검색 중 Enter → 2쪽으로 순환 점프 안 함', s().currentPage === 20, `현재 ${s().currentPage + 1}쪽`)
resume()
await run1
check('검색 완료 → 현재 쪽 이후 첫 결과(30쪽)로 이동', s().findIndex === 1 && s().currentPage === 30, `idx=${s().findIndex} 쪽=${s().currentPage + 1}`)

// ── 2. 검색 도중 사용자가 이미 이동했으면 늦게 온 결과가 덮어쓰지 않는다 ──
hitPages[1] = [21, 22, 33]
s().set({ currentPage: 20 })
pauseAfter(2) // 0~23쪽(21·22쪽 결과)까지 응답, 다음 구간 대기
const run2 = finder.runFind('x', true)
await flush()
check('21쪽 결과로 자동 이동', s().findIndex === 0 && s().currentPage === 21)
finder.findStep(1) // 사용자가 22쪽으로
await flush()
check('사용자 Enter → 22쪽', s().findIndex === 1 && s().currentPage === 22)
resume()
await run2
check('늦게 온 결과가 사용자 위치를 덮어쓰지 않음', s().findIndex === 1 && s().currentPage === 22, `idx=${s().findIndex} 쪽=${s().currentPage + 1}`)
check('결과는 끝까지 누적', s().findHits.length === 3 && s().findStatus === 'done')

// ── 3. 검색 도중 같은 탭 문서가 바뀌면(쪽 삭제·재레이아웃) 옛 결과를 섞지 않는다 ──
// 15쪽 결과는 멈춰 있는 두 번째 구간(12~23쪽) 요청에 옛 내용으로 실려 돌아온다
hitPages[1] = [2, 15]
s().set({ currentPage: 0 })
pauseAfter(1)
void finder.runFind('x', true)
await flush()
check('문서 변경 전: 2쪽 결과', s().findHits.map((h) => h.page).join() === '2')
hitPages[1] = [5] // 편집으로 내용이 바뀜
s().set({ info: mkInfo('a.pdf', 38) })
await flush()
check('문서 변경 즉시 옛 결과 제거(쪽 번호가 어긋남)', s().findHits.length === 0, s().findHits.map((h) => h.page).join())
resume()
await flush()
check('멈춰 있던 옛 검색이 결과를 덧붙이지 않음', !s().findHits.some((h) => h.page === 15 || h.page === 2), s().findHits.map((h) => h.page).join())
await sleep(250) // 재검색 디바운스
check('재검색 결과 = 새 문서 기준', s().findHits.map((h) => h.page).join() === '5' && s().findStatus === 'done', s().findHits.map((h) => h.page).join())

// ── 4. 검색 도중 탭 전환 → 옛 검색이 새 탭을 이동시키지 않는다 ──
hitPages[1] = [30]
hitPages[2] = []
s().set({ currentPage: 0 })
pauseAfter(1)
void finder.runFind('x', true)
await flush()
s().openTab(2, mkInfo('b.pdf', 40)) // 새 탭 활성
resume()
await sleep(250)
check('탭 전환 후 새 탭 위치 그대로', s().activeDocId === 2 && s().currentPage === 0, `쪽=${s().currentPage + 1}`)
check('새 탭 기준으로 재검색', s().findDocId === 2 && s().findHits.length === 0 && s().findStatus === 'done')

// ── 5. 막대가 열린 상태의 Ctrl+F 는 입력한 검색어를 옛 선택으로 덮어쓰지 않는다 ──
finder.closeFind()
hitPages[2] = [1]
s().set({ selection: { page: 0, quads: [], text: 'apple' } })
finder.openFind()
check('닫힌 막대 열기 → 선택 텍스트로 프리필', s().findQuery === 'apple')
finder.setFindQuery('banana')
await sleep(300)
finder.openFind() // 다시 Ctrl+F (선택은 그대로 남아 있음)
await flush()
check('열린 막대에서 Ctrl+F → 검색어 유지', s().findQuery === 'banana', s().findQuery)

unsubscribe()
console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
