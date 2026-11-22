/**
 * EPUB 밑줄 위치 기억(텍스트 앵커) 단위 검증 — 쪽 번호 대신 "문장 + 앞뒤 문맥"으로 위치를 찾는다.
 * 글자 크기를 바꿔 쪽 나눔이 달라져도, 같은 문구가 여러 번 나와도 제자리를 찾아야 한다.
 */
import {
  compactChars,
  charsInQuads,
  buildAnchor,
  resolveAnchor,
  rectsForRange,
  ANCHOR_CONTEXT,
  type PageChar
} from '../src/shared/anchor'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

/** 한 줄 = 글자 10pt 폭, 줄 높이 20pt 인 가짜 쪽 글자 배열 */
function fakePage(lines: string[]): PageChar[] {
  const out: PageChar[] = []
  lines.forEach((line, li) => {
    ;[...line].forEach((c, ci) => {
      const x0 = ci * 10
      const y0 = li * 20
      out.push({ c, line: li, quad: [x0, y0, x0 + 10, y0, x0, y0 + 16, x0 + 10, y0 + 16] })
    })
  })
  return out
}

// ── 공백 제거 문자열 + 원래 글자 위치 매핑 ──
const p = fakePage(['가나 다라', '마바사'])
const cp = compactChars(p)
check('공백 제거', cp.text === '가나다라마바사', cp.text)
check('매핑: 다 → 원래 인덱스 3', cp.map[2] === 3, `${cp.map[2]}`)

// ── 선택 쿼드에 걸친 글자 범위 ──
const quad = [30, 0, 50, 0, 30, 16, 50, 16] // '다라'
check('쿼드 안 글자 범위 = [3,4]', JSON.stringify(charsInQuads(p, [quad])) === '[3,4]', JSON.stringify(charsInQuads(p, [quad])))
check('빈 쿼드 → null', charsInQuads(p, []) === null)

// ── 앵커 생성 (앞뒤 문맥은 이웃 쪽까지 이어서) ──
const a = buildAnchor({ prev: '이전쪽끝', cur: cp.text, next: '다음쪽처음' }, 2, 4, 0.5)
check('exact', a.exact === '다라', a.exact)
check('prefix는 이전 쪽 끝까지 이어짐', a.prefix === '이전쪽끝가나', a.prefix)
check('suffix는 다음 쪽 처음까지 이어짐', a.suffix === '마바사다음쪽처음', a.suffix)
check('ratio 보존', a.ratio === 0.5)
const long = 'x'.repeat(100)
const a2 = buildAnchor({ prev: long, cur: '가', next: long }, 0, 1, 0)
check(`문맥 길이 상한 ${ANCHOR_CONTEXT}`, a2.prefix.length === ANCHOR_CONTEXT && a2.suffix.length === ANCHOR_CONTEXT)

// ── 위치 찾기: 같은 문구가 여러 번 나오면 문맥으로 고른다 ──
// 쪽마다 "그는 말했다"가 나오지만 앞 문맥이 다르다
const pages = [
  '첫째날아침그는말했다좋은날이야',
  '둘째날점심그는말했다배가고파',
  '셋째날저녁그는말했다이제자자',
  '넷째날새벽그는말했다잠이안와'
]
const get = (i: number): string => pages[i] ?? ''
const target = buildAnchor({ prev: get(1), cur: get(2), next: get(3) }, 5, 10, 2 / 4)
const r = resolveAnchor(target, pages.length, get)
check('문맥으로 셋째 쪽을 찾음', !!r && r.segments[0].page === 2, JSON.stringify(r))
// 비율(ratio)이 틀려도 문맥이 맞는 쪽이 이긴다 (재배치로 쪽 수가 바뀐 상황)
const wrongRatio = { ...target, ratio: 0 }
const r2 = resolveAnchor(wrongRatio, pages.length, get)
check('비율이 어긋나도 문맥 우선', !!r2 && r2.segments[0].page === 2, JSON.stringify(r2))

// ── 쪽 경계를 넘는 밑줄: 재배치 후 두 쪽에 걸치면 쪽별로 나눈다 ──
const split = ['아무말앞부분밑줄의앞', '절반뒷절반입니다끝']
const getS = (i: number): string => split[i] ?? ''
const anc = { exact: '밑줄의앞절반뒷절반', prefix: '아무말앞부분', suffix: '입니다끝', ratio: 0 }
const rs = resolveAnchor(anc, split.length, getS)
check('두 쪽에 걸침 → 구간 2개', !!rs && rs.segments.length === 2, JSON.stringify(rs))
check(
  '구간 위치 정확',
  !!rs && rs.segments[0].page === 0 && rs.segments[0].start === 6 && rs.segments[0].end === 10 &&
    rs.segments[1].page === 1 && rs.segments[1].start === 0 && rs.segments[1].end === 5,
  JSON.stringify(rs?.segments)
)

// ── 못 찾으면 null ──
check('없는 문구 → null', resolveAnchor({ exact: '존재하지않음', prefix: '', suffix: '', ratio: 0 }, pages.length, get) === null)

// ── 먼 쪽도 결국 찾는다 (비율 창 밖 → 전체 탐색) ──
const many = Array.from({ length: 60 }, (_, i) => `쪽${i}내용`)
many[55] = '여기에특별한문장이있다'
const getM = (i: number): string => many[i] ?? ''
const far = resolveAnchor({ exact: '특별한문장', prefix: '여기에', suffix: '이있다', ratio: 0 }, many.length, getM)
check('비율 창 밖이면 전체 탐색', !!far && far.segments[0].page === 55, JSON.stringify(far))

// ── 큰 글씨로 재배치돼 한 밑줄이 4쪽 이상에 걸쳐도 찾는다 ──
const longPages = ['앞문맥입니다긴밑줄시', '작둘째', '셋째쪽', '넷째쪽', '다섯끝뒤문맥']
const getL = (i: number): string => longPages[i] ?? ''
const longAnchor = { exact: '긴밑줄시작둘째셋째쪽넷째쪽다섯끝', prefix: '앞문맥입니다', suffix: '뒤문맥', ratio: 0 }
const rl = resolveAnchor(longAnchor, longPages.length, getL)
check('5쪽에 걸친 밑줄도 찾음', !!rl && rl.segments.length === 5, JSON.stringify(rl?.segments))

// ── 빈 쪽(그림만 있는 쪽)을 건너뛰고 이어진다 ──
const withBlank = ['앞부분밑줄은', '', '여기까지뒤']
const getB = (i: number): string => withBlank[i] ?? ''
const rb = resolveAnchor({ exact: '밑줄은여기까지', prefix: '앞부분', suffix: '뒤', ratio: 0 }, withBlank.length, getB)
check(
  '빈 쪽 건너뛰고 끝까지 표시',
  !!rb && rb.segments.length === 2 && rb.segments[1].page === 2 && rb.segments[1].end === 4,
  JSON.stringify(rb?.segments)
)

// ── 글자 범위 → 줄별 사각형 ──
const rects = rectsForRange(p, cp.map, 1, 6) // '나다라마바' (공백 제외 인덱스 1..5)
check('두 줄 → 사각형 2개', rects.length === 2, JSON.stringify(rects))
check('첫 줄 사각형: 나(10)~라(50)', rects[0][0] === 10 && rects[0][2] === 50, JSON.stringify(rects[0]))
check('둘째 줄 사각형: 마(0)~바(20)', rects[1][0] === 0 && rects[1][2] === 20 && rects[1][1] === 20, JSON.stringify(rects[1]))

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
