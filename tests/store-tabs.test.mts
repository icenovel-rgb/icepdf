/**
 * 문서별 상태 갱신(updateDoc) 검증 — 비동기 작업(예: EPUB 글자 크기 재레이아웃)이 끝났을 때
 * 그 사이 탭이 바뀌었으면 결과가 "지금 활성 탭"이 아니라 "작업을 시작한 문서의 탭"에 들어가야 한다.
 */
import { useStore } from '../src/renderer/src/state/store'
import type { DocInfo } from '../src/shared/types'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

const mkInfo = (title: string, pageCount: number, kind: 'pdf' | 'epub'): DocInfo => ({
  filePath: null,
  pageCount,
  pages: Array.from({ length: pageCount }, () => ({ width: 480, height: 680 })),
  outline: [],
  title,
  kind,
  fontSize: kind === 'epub' ? 14 : null
})

const s = (): ReturnType<typeof useStore.getState> => useStore.getState()
const epubA = mkInfo('a.epub', 9, 'epub')
const pdfB = mkInfo('b.pdf', 3, 'pdf')

s().openTab(1, epubA) // 탭1 = EPUB (docId 1)
s().openTab(2, pdfB) // 탭2 = PDF (docId 2) — 활성
const tabA = s().tabs[0].id

// 비활성 문서(EPUB)에 결과 반영 → 활성 PDF 탭은 그대로, EPUB 탭 스냅샷만 갱신
const epubA2 = { ...epubA, pageCount: 11, fontSize: 18 }
s().updateDoc(1, (slice) => ({ info: epubA2, epoch: slice.epoch + 1, currentPage: 8 }))
check('활성 PDF 탭 info 그대로', s().info === pdfB && s().info?.kind === 'pdf')
check('활성 PDF 탭 epoch 그대로', s().epoch === 0)
const snapA = s().tabs.find((t) => t.id === tabA)?.snapshot
check('EPUB 탭 스냅샷에 반영', snapA?.info === epubA2 && snapA?.epoch === 1 && snapA?.currentPage === 8)

// 그 탭으로 돌아오면 갱신된 상태가 보인다
s().switchTab(tabA)
check('EPUB 탭 복귀 → 새 쪽수·글자 크기', s().info?.pageCount === 11 && s().info?.fontSize === 18)
check('EPUB 탭 복귀 → 갱신된 위치로', s().currentPage === 8 && s().scrollTarget === 8)

// 활성 문서에 반영 → 라이브 상태 갱신
s().updateDoc(1, (slice) => ({ epoch: slice.epoch + 1 }))
check('활성 문서는 라이브 상태 갱신', s().epoch === 2)

// 없는 문서(이미 닫힌 탭) → 아무것도 안 바뀜
const before = JSON.stringify(s().tabs.map((t) => t.snapshot.epoch))
s().updateDoc(99, () => ({ epoch: 123 }))
check('닫힌 문서 → 무시', JSON.stringify(s().tabs.map((t) => t.snapshot.epoch)) === before && s().epoch === 2)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
