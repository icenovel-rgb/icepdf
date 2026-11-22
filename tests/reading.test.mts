/**
 * 읽기 기록(library.json) 검증 — 읽던 곳 복귀 계산, IPC 경계 입력 검증, 손상된 파일 관용 로드, 테마 정의.
 */
import {
  EPUB_THEMES,
  isEpubTheme,
  parseLibrary,
  sanitizeBookPatch,
  sanitizeSettings,
  resumeTarget,
  mergeBook,
  pdfDocKey,
  colorToHex,
  notesToMarkdown,
  sortNotes,
  addNoteTo,
  removeNoteFrom
} from '../src/shared/reading'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

// ── 테마 ──
check('테마 3종', Object.keys(EPUB_THEMES).join(',') === 'light,sepia,dark')
check('화이트는 CSS 없음(원본 그대로)', EPUB_THEMES.light.css === '')
check('다크는 배경·글자색 지정', /background-color/.test(EPUB_THEMES.dark.css) && /color/.test(EPUB_THEMES.dark.css))
check('CSS는 여백을 건드리지 않음(쪽 수 불변)', !/margin|padding|@page|font-size/.test(EPUB_THEMES.dark.css + EPUB_THEMES.sepia.css))
check('테마 판별', isEpubTheme('dark') && !isEpubTheme('pink') && !isEpubTheme(3))

// ── 읽던 곳 복귀 ──
check('쪽 수 같으면 그 쪽 그대로', resumeTarget({ lastPage: 7, pageCount: 20 }, 20) === 7)
check('쪽 수 바뀌면 비율로', resumeTarget({ lastPage: 10, pageCount: 20 }, 40) === 20)
check('범위 밖이면 마지막 쪽으로', resumeTarget({ lastPage: 99, pageCount: 100 }, 100) === 99 && resumeTarget({ lastPage: 120, pageCount: 120 }, 50) === 49)
check('음수·NaN → 0', resumeTarget({ lastPage: -3, pageCount: 10 }, 10) === 0 && resumeTarget({ lastPage: NaN, pageCount: 10 }, 10) === 0)

// ── PDF 키: 경로 기반, 윈도우 대소문자·구분자 무시 ──
check('PDF 키 정규화', pdfDocKey('C:\\Books\\A.pdf') === pdfDocKey('c:/books/a.PDF'), pdfDocKey('C:\\Books\\A.pdf'))

// ── IPC 경계 검증 ──
const ok = sanitizeBookPatch({ lastPage: 3, pageCount: 10, fontSize: 18, title: '책', evil: 'x' })
check('허용 필드만 통과', JSON.stringify(Object.keys(ok).sort()) === JSON.stringify(['fontSize', 'lastPage', 'pageCount', 'title']), JSON.stringify(ok))
const bad = sanitizeBookPatch({ lastPage: 'abc', pageCount: -1, fontSize: 1e9, title: 42 })
check('잘못된 값은 버림', Object.keys(bad).length === 0, JSON.stringify(bad))
const notes = sanitizeBookPatch({
  notes: [
    { id: 'n1', color: '#ffe04d', style: 'underline', text: '문장', createdAt: 1, anchor: { exact: '문장', prefix: '', suffix: '', ratio: 0.5 } },
    { id: 'n2', color: 'javascript:alert(1)', style: 'highlight', text: 'x', createdAt: 1, anchor: { exact: 'x', prefix: '', suffix: '', ratio: 0 } },
    { id: 'n3', color: '#000000', style: 'bogus', text: 'y', createdAt: 1, anchor: { exact: 'y', prefix: '', suffix: '', ratio: 0 } },
    'garbage'
  ]
})
check('밑줄: 올바른 것만 남김', notes.notes?.length === 1 && notes.notes[0].id === 'n1', JSON.stringify(notes.notes))
check('설정 검증', sanitizeSettings({ epubTheme: 'dark', x: 1 }).epubTheme === 'dark' && sanitizeSettings({ epubTheme: 'neon' }).epubTheme === undefined)

// ── 손상된 파일도 열린다 ──
check('null → 빈 서재', Object.keys(parseLibrary(null).books).length === 0 && parseLibrary(null).settings.epubTheme === 'light')
const lib = parseLibrary({ version: 1, settings: { epubTheme: 'sepia' }, books: { k: { lastPage: 2, pageCount: 5, title: 't' }, bad: 7 } })
check('정상 책만 로드 + 설정 유지', !!lib.books.k && !lib.books.bad && lib.settings.epubTheme === 'sepia', JSON.stringify(lib))

// ── 병합: 패치한 필드만 덮고 나머지는 유지 ──
const merged = mergeBook(lib.books.k, { lastPage: 4 }, 1000)
check('병합: 다른 필드 유지', merged.lastPage === 4 && merged.title === 't' && merged.updatedAt === 1000)
const fresh = mergeBook(undefined, { lastPage: 1 }, 5)
check('새 책 기본값', fresh.lastPage === 1 && Array.isArray(fresh.notes) && fresh.notes.length === 0)

// ── 주석 색 → hex ──
check('색 변환', colorToHex([1, 0.878, 0.302]) === '#ffe04d', colorToHex([1, 0.878, 0.302]))

// ── 밑줄 원자적 추가·삭제: 저장된 기록 위에 합친다 (같은 책을 두 탭에서 열어도 서로 안 지움) ──
const anc = { exact: '문장', prefix: '', suffix: '', ratio: 0 }
const nA = { id: 'a', color: '#ffe04d', style: 'highlight' as const, text: 'A', anchor: anc, createdAt: 1 }
const nB = { id: 'b', color: '#ffe04d', style: 'highlight' as const, text: 'B', anchor: anc, createdAt: 2 }
const nC = { id: 'c', color: '#ffe04d', style: 'highlight' as const, text: 'C', anchor: anc, createdAt: 3 }
// 탭1이 b를, 탭2가 c를 — 각자 오래된 목록을 들고 있어도 저장소 기준으로 합쳐진다
const disk1 = addNoteTo(mergeBook(undefined, { notes: [nA] }, 0), nB, 10)
const disk2 = addNoteTo(disk1, nC, 11)
check('두 탭에서 각각 추가 → 셋 다 남음', disk2.notes.map((n) => n.id).join('') === 'abc', disk2.notes.map((n) => n.id).join(''))
check('같은 id 다시 추가 → 중복 없음', addNoteTo(disk2, nC, 12).notes.length === 3)
check('추가는 원본을 바꾸지 않음(불변)', disk1.notes.length === 2)
const disk3 = removeNoteFrom(disk2, 'b', 13)
check('삭제는 그 id만', disk3.notes.map((n) => n.id).join('') === 'ac')
check('없는 id 삭제 → 그대로', removeNoteFrom(disk3, 'zz', 14).notes.length === 2)
check('기록이 없던 책에 추가 → 새 기록', addNoteTo(undefined, nA, 5).notes.length === 1)

// ── 모아보기 정렬·Markdown ──
const items = [
  { id: 'b', source: 'epub' as const, page: 5, y: 10, text: '둘째', color: '#ffe04d', style: 'highlight' as const, createdAt: 2 },
  { id: 'a', source: 'epub' as const, page: 1, y: 300, text: '첫째\n줄바꿈', color: '#7ee081', style: 'underline' as const, createdAt: 1 },
  { id: 'c', source: 'epub' as const, page: -1, y: 0, text: '못 찾음', color: '#ff8fb1', style: 'highlight' as const, createdAt: 3 },
  { id: 'd', source: 'epub' as const, page: 1, y: 20, text: '같은 쪽 위', color: '#ff8fb1', style: 'highlight' as const, createdAt: 4 }
]
const sorted = sortNotes(items)
check('정렬: 쪽 → 위치, 못 찾은 것은 맨 뒤', sorted.map((n) => n.id).join('') === 'dabc', sorted.map((n) => n.id).join(''))
const md = notesToMarkdown('어린 왕자', sorted)
check('Markdown 제목', md.startsWith('# 어린 왕자 — 밑줄\n'), md.slice(0, 30))
check('인용문 여러 줄은 줄마다 >', md.includes('> 첫째\n> 줄바꿈'), md)
check('쪽 번호 1부터', md.includes('— 2쪽') && md.includes('— 6쪽'))
check('못 찾은 밑줄 표기', md.includes('— 위치를 찾지 못함'))

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
