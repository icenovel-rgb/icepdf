/** 문장 카드 레이아웃 — 한글 줄바꿈(띄어쓰기 우선, 긴 덩어리는 글자 단위), 글자 크기 자동 맞춤, 비율 */
import { graphemes, wrapText, wrapLines, fitText, fitLines, justifyLine, CARD_ALIGNS, SOURCE_ALIGNS, CARD_RATIOS, cardSize } from '../src/renderer/src/lib/quote-card'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

// 글자 하나 = 10px 인 가짜 측정기
const measure = (s: string): number => [...s].length * 10

const w1 = wrapText('나는 오늘 아침 커피를 마셨다', 70, measure)
check('띄어쓰기 기준 줄바꿈', JSON.stringify(w1) === JSON.stringify(['나는 오늘', '아침 커피를', '마셨다']), JSON.stringify(w1))
check('줄마다 폭 이내', w1.every((l) => measure(l) <= 70))

const w2 = wrapText('띄어쓰기없이아주길게이어지는문장', 50, measure)
check('긴 덩어리는 글자 단위로 자름', w2.every((l) => measure(l) <= 50) && w2.join('') === '띄어쓰기없이아주길게이어지는문장', JSON.stringify(w2))

const w3 = wrapText('첫 문단\n\n둘째 문단', 200, measure)
check('문단(빈 줄) 유지', JSON.stringify(w3) === JSON.stringify(['첫 문단', '', '둘째 문단']), JSON.stringify(w3))

const w4 = wrapText('  앞뒤   공백  ', 200, measure)
check('여러 공백은 하나로, 앞뒤 공백 제거', JSON.stringify(w4) === JSON.stringify(['앞뒤 공백']), JSON.stringify(w4))

// 글자 크기 자동 맞춤: 상자에 들어가는 가장 큰 크기
const measureAt = (size: number) => (s: string): number => [...s].length * size
const fit = fitText('가나다라마바사아자차카타파하'.repeat(3), { width: 200, height: 120, maxSize: 60, minSize: 12, lineHeight: 1.5, measureAt })
const totalH = fit.lines.length * fit.size * 1.5
check('맞춘 크기는 상자 안에', totalH <= 120 && fit.lines.every((l) => measureAt(fit.size)(l) <= 200), `size=${fit.size} lines=${fit.lines.length}`)
check('더 큰 크기는 넘침 (최대한 크게)', (() => {
  const s = fit.size + 2
  const lines = wrapText('가나다라마바사아자차카타파하'.repeat(3), 200, measureAt(s))
  return lines.length * s * 1.5 > 120
})())
const tiny = fitText('가'.repeat(500), { width: 100, height: 40, maxSize: 40, minSize: 14, lineHeight: 1.5, measureAt })
check('아무리 길어도 최소 크기 아래로는 안 줄임', tiny.size === 14)

// 문단 마지막 줄 표시 (양쪽 정렬은 마지막 줄을 늘리지 않는다)
const wl = wrapLines('나는 오늘 아침 커피를 마셨다\n둘째 문단', 70, measure)
check(
  '문단 마지막 줄 = last',
  JSON.stringify(wl.map((l) => [l.text, l.last])) ===
    JSON.stringify([['나는 오늘', false], ['아침 커피를', false], ['마셨다', true], ['둘째 문단', true]]),
  JSON.stringify(wl)
)
check('빈 줄도 last', wrapLines('가\n\n나', 100, measure)[1]?.last === true)
const fitOpts = { width: 60, height: 400, maxSize: 20, minSize: 10, lineHeight: 1.5, measureAt }
const fl = fitLines('가나다 라마바 사아자 차카타', fitOpts)
check('fitLines = fitText와 같은 줄', JSON.stringify(fl.lines.map((l) => l.text)) === JSON.stringify(fitText('가나다 라마바 사아자 차카타', fitOpts).lines))

// 양쪽 정렬 — 낱말 사이를 벌려 오른쪽 끝을 상자 폭에 맞춘다
const j1 = justifyLine('나는 오늘 아침', 100, measure) // 글자 7개 = 70px, 남는 30px를 낱말 사이 2곳에
check('낱말 3개 → 조각 3개', j1.length === 3 && j1.map((p) => p.text).join('|') === '나는|오늘|아침', JSON.stringify(j1))
check('첫 조각은 왼쪽 끝', j1[0].x === 0)
const lastEnd = j1[2].x + measure(j1[2].text)
check('마지막 조각 끝 = 상자 폭', Math.abs(lastEnd - 100) < 1e-9, `${lastEnd}`)
check('사이 간격이 고르다', Math.abs(j1[1].x - measure(j1[0].text) - (j1[2].x - j1[1].x - measure(j1[1].text))) < 1e-9)
const j2 = justifyLine('띄어쓰기없는줄', 80, measure) // 70px → 글자 사이 6곳에 나눠 80px
check('띄어쓰기 없으면 글자 사이를 벌림', j2.length === 7 && Math.abs(j2[6].x + 10 - 80) < 1e-9, JSON.stringify(j2.map((p) => p.x)))
check('너무 짧은 줄은 벌리지 않음', justifyLine('짧은 줄', 300, measure).length === 1)
check('넘치는 줄은 그대로', justifyLine('가나다 라마바', 40, measure).length === 1)

// 자소 묶음 — 풀어 쓴 한글(NFD)·결합 문자·이모지 가족을 한 글자로
const nfd = '한글'.normalize('NFD')
check('풀어 쓴 한글도 두 글자', graphemes(nfd).length === 2, `${[...nfd].length}개 코드 포인트`)
check('이모지 가족 = 한 글자', graphemes('👨‍👩‍👧').length === 1)
const jn = justifyLine(nfd + nfd, 50, (t) => graphemes(t).length * 10)
check('양쪽 정렬이 자모를 쪼개지 않음', jn.length === 4 && jn.every((p) => p.text.normalize('NFC').length === 1), JSON.stringify(jn.map((p) => p.text.normalize('NFC'))))

// 정렬 선택지
check('문장 정렬 4종 (왼쪽·가운데·오른쪽·양쪽)', CARD_ALIGNS.map((a) => a.id).join(',') === 'left,center,right,justify')
check('출처 정렬 3종', SOURCE_ALIGNS.map((a) => a.id).join(',') === 'left,center,right')

// 비율
check('비율 3종', CARD_RATIOS.map((r) => r.id).join(',') === '1:1,4:5,9:16')
const s45 = cardSize('4:5')
check('4:5 = 1080×1350', s45.width === 1080 && s45.height === 1350)
check('알 수 없는 비율 → 기본 4:5', cardSize('x' as never).height === 1350)

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
