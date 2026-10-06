/** 문서 종류(PDF/EPUB) 판별·이름·EPUB 글자 크기·리플로우 후 쪽 위치 보존 단위 검증 */
import {
  docKindOf,
  isOpenableDocPath,
  docBaseName,
  clampEpubFontSize,
  mapPageAfterRelayout,
  isReadOnlyKind,
  EPUB_FONT,
  EPUB_PAGE
} from '../src/shared/doc-kind'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

// ── 종류 판별 ──
check('book.epub → epub', docKindOf('C:/x/book.epub') === 'epub')
check('대문자 확장자 BOOK.EPUB → epub', docKindOf('BOOK.EPUB') === 'epub')
check('a.pdf → pdf', docKindOf('a.pdf') === 'pdf')
check('확장자 없음 → pdf(기본)', docKindOf('noext') === 'pdf')
check('열 수 있는 경로: pdf/epub', isOpenableDocPath('a.PDF') && isOpenableDocPath('b.epub'))
check('열 수 없는 경로: png/hwpx', !isOpenableDocPath('a.png') && !isOpenableDocPath('a.hwpx'))
check('epub은 읽기 전용, pdf는 편집 가능', isReadOnlyKind('epub') && !isReadOnlyKind('pdf'))

// ── 기본 이름 (내보내기 파일명용) ──
check('book.epub → book', docBaseName('book.epub') === 'book')
check('보고서.PDF → 보고서', docBaseName('보고서.PDF') === '보고서')
check('확장자 없음 유지', docBaseName('제목 없음') === '제목 없음')
check('중간 점은 유지 (v1.2.epub → v1.2)', docBaseName('v1.2.epub') === 'v1.2')
check('빈 제목 → 문서', docBaseName('') === '문서')

// ── EPUB 글자 크기 ──
check('기본 글자 크기는 범위 안', EPUB_FONT.default >= EPUB_FONT.min && EPUB_FONT.default <= EPUB_FONT.max)
check('최소 미만 → 최소', clampEpubFontSize(1) === EPUB_FONT.min)
check('최대 초과 → 최대', clampEpubFontSize(999) === EPUB_FONT.max)
check('범위 안은 그대로', clampEpubFontSize(16) === 16)
check('NaN → 기본값', clampEpubFontSize(Number.NaN) === EPUB_FONT.default)
check('EPUB 페이지는 세로형', EPUB_PAGE.height > EPUB_PAGE.width)

// ── 리플로우 후 쪽 위치 보존 (읽던 비율 유지) ──
check('첫 쪽은 첫 쪽', mapPageAfterRelayout(0, 10, 20) === 0)
check('절반 지점 유지 (5/10 → 10/20)', mapPageAfterRelayout(5, 10, 20) === 10)
check('글자 키움: 마지막 쪽 근처 유지', mapPageAfterRelayout(9, 10, 20) === 18)
check('글자 줄임: 3/12 → 1/6', mapPageAfterRelayout(3, 12, 6) === 1)
check('결과는 새 쪽수 범위 안', mapPageAfterRelayout(11, 12, 3) <= 2)
check('이전 쪽수 0/1 → 0', mapPageAfterRelayout(0, 1, 5) === 0 && mapPageAfterRelayout(0, 0, 5) === 0)
check('새 쪽수 1 → 0', mapPageAfterRelayout(7, 10, 1) === 0)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
