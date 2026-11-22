/** 문장 카드 레이아웃 — 한글 줄바꿈(띄어쓰기 우선, 긴 덩어리는 글자 단위), 글자 크기 자동 맞춤, 비율 */
import { wrapText, fitText, CARD_RATIOS, cardSize } from '../src/renderer/src/lib/quote-card'

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

// 비율
check('비율 3종', CARD_RATIOS.map((r) => r.id).join(',') === '1:1,4:5,9:16')
const s45 = cardSize('4:5')
check('4:5 = 1080×1350', s45.width === 1080 && s45.height === 1350)
check('알 수 없는 비율 → 기본 4:5', cardSize('x' as never).height === 1350)

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
