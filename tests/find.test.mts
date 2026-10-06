/** 찾기(Ctrl+F) 핵심 로직 단위 검증 — 결과 탐색·순환·페이지별 분류·상태 문구·선택 영역 프리필 */
import {
  firstHitFrom,
  lastHitUpTo,
  stepHit,
  hitsForPage,
  hitTop,
  findStatusText,
  queryFromSelection
} from '../src/renderer/src/lib/find'
import type { SearchHit } from '../src/shared/types'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const q = (y: number): number[] => [10, y, 50, y, 10, y + 12, 50, y + 12]
const hits: SearchHit[] = [
  { page: 1, quads: [q(100)] },
  { page: 1, quads: [q(300)] },
  { page: 4, quads: [q(50), q(64)] },
  { page: 7, quads: [q(20)] }
]

// ── 시작 위치: 현재 쪽 이후 첫 결과 (없으면 처음으로 순환) ──
check('현재 0쪽 → 첫 결과(0)', firstHitFrom(hits, 0) === 0)
check('현재 1쪽 → 1쪽 첫 결과(0)', firstHitFrom(hits, 1) === 0)
check('현재 2쪽 → 4쪽 결과(2)', firstHitFrom(hits, 2) === 2)
check('현재 8쪽 → 이후 없음 → 처음(0)', firstHitFrom(hits, 8) === 0)
check('결과 없음 → -1', firstHitFrom([], 3) === -1)

// ── 이전 방향 시작: 현재 쪽 이하 마지막 결과 (없으면 끝으로 순환) ──
check('현재 5쪽 → 4쪽 결과(2)', lastHitUpTo(hits, 5) === 2)
check('현재 1쪽 → 1쪽 마지막(1)', lastHitUpTo(hits, 1) === 1)
check('현재 0쪽 → 이전 없음 → 끝(3)', lastHitUpTo(hits, 0) === 3)
check('결과 없음 → -1', lastHitUpTo([], 0) === -1)

// ── 다음/이전 순환 ──
check('다음: 0 → 1', stepHit(0, 4, 1) === 1)
check('다음: 끝 → 처음', stepHit(3, 4, 1) === 0)
check('이전: 처음 → 끝', stepHit(0, 4, -1) === 3)
check('이전: 2 → 1', stepHit(2, 4, -1) === 1)
check('결과 0개 → -1', stepHit(0, 0, 1) === -1)

// ── 페이지별 분류 (전역 인덱스 보존 — 현재 결과 강조용) ──
check('1쪽 결과 2개 + 전역 인덱스', eq(hitsForPage(hits, 1).map((h) => h.index), [0, 1]))
check('4쪽 결과 1개(쿼드 2개)', hitsForPage(hits, 4).length === 1 && hitsForPage(hits, 4)[0].quads.length === 2)
check('결과 없는 쪽 → 빈 배열', hitsForPage(hits, 2).length === 0)

// ── 결과 위치(스크롤용) — 쿼드들의 최상단 y ──
check('hitTop = 쿼드 최소 y', hitTop(hits[2]) === 50)

// ── 상태 문구 ──
check('검색 전 → 빈 문구', findStatusText({ query: '', status: 'idle', index: -1, total: 0, capped: false }) === '')
check('결과 없음', findStatusText({ query: '펭귄', status: 'done', index: -1, total: 0, capped: false }) === '결과 없음')
check('3 / 27', findStatusText({ query: '펭귄', status: 'done', index: 2, total: 27, capped: false }) === '3 / 27')
check('상한 도달 → 5000+', findStatusText({ query: 'a', status: 'done', index: 0, total: 5000, capped: true }) === '1 / 5000+')
check('검색 중 (결과 누적)', findStatusText({ query: 'a', status: 'searching', index: -1, total: 12, capped: false }) === '검색 중… 12')
check('검색 중 + 현재 위치', findStatusText({ query: 'a', status: 'searching', index: 0, total: 12, capped: false }) === '1 / 12…')

// ── 선택 영역 → 검색어 프리필 (한 줄·짧은 텍스트만) ──
check('짧은 선택 → 그대로(trim)', queryFromSelection('  펭귄 ') === '펭귄')
check('여러 줄 선택 → 프리필 안 함', queryFromSelection('첫 줄\n둘째 줄') === '')
check('너무 긴 선택 → 프리필 안 함', queryFromSelection('가'.repeat(200)) === '')
check('선택 없음 → 빈 문자열', queryFromSelection(undefined) === '')

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
