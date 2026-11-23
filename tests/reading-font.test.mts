/**
 * EPUB 읽기 글꼴 — ① 글꼴 파일 이름표 읽기(실제 윈도우 글꼴) ② 가족 묶기·보통/굵게 고르기
 * ③ 실제 mupdf에 글꼴 콜백 + CSS를 걸면 본문이 그 글꼴로 배치되는지.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import { groupFamilies, parseFontFaces, readingFontFamilies, type FontFace, type ReadAt } from '../src/main/fonts'
import { READING_FONT_FAMILY, readingFontCss } from '../src/shared/reading'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const epubPath = path.join(root, 'samples', 'sample.epub')

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}
const bufReader = (buf: Buffer): ReadAt => async (o, l) => buf.subarray(o, o + l)
const facesOf = async (p: string): Promise<FontFace[]> => parseFontFaces(bufReader(readFileSync(p)), p)

// ── ① 이름표 읽기 ──
check('글꼴이 아닌 파일 → 빈 목록', (await parseFontFaces(bufReader(Buffer.from('hello world, not a font at all')), 'x.ttf')).length === 0)
check('짧은 파일 → 빈 목록', (await parseFontFaces(bufReader(Buffer.alloc(4)), 'x.ttf')).length === 0)

const FONTS = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts'
const malgun = path.join(FONTS, 'malgun.ttf')
if (existsSync(malgun)) {
  const [f] = await facesOf(malgun)
  check('맑은 고딕: 영문·한글 가족 이름', f?.family === 'Malgun Gothic' && f?.familyKo === '맑은 고딕', JSON.stringify(f))
  check('맑은 고딕: 한글 지원·보통 굵기', f?.korean === true && f?.weight === 400 && !f.italic)
  const [b] = await facesOf(path.join(FONTS, 'malgunbd.ttf'))
  check('맑은 고딕 Bold: 같은 가족·700', b?.family === 'Malgun Gothic' && b?.weight === 700, JSON.stringify(b))
} else console.log('[SKIP] malgun.ttf 없음')

const batang = path.join(FONTS, 'batang.ttc')
if (existsSync(batang)) {
  const faces = await facesOf(batang)
  check('batang.ttc: 면 4개(TTC)', faces.length === 4, faces.map((f) => `${f.index}:${f.family}`).join(', '))
  check('batang.ttc: 바탕·궁서 한글 이름', faces[0]?.familyKo === '바탕' && faces.some((f) => f.family === 'Gungsuh' && f.familyKo === '궁서'))
  check('batang.ttc: 면마다 번호', faces.every((f, i) => f.index === i && f.korean))
}

const arial = path.join(FONTS, 'arial.ttf')
if (existsSync(arial)) {
  const [a] = await facesOf(arial)
  check('Arial: 한글 미지원으로 판정', a?.family === 'Arial' && a?.korean === false, JSON.stringify(a))
}

// ── ② 가족 묶기 ──
const face = (family: string, weight: number, extra: Partial<FontFace> = {}): FontFace => ({
  path: `C:/f/${family}-${weight}${extra.italic ? 'i' : ''}.ttf`,
  index: 0,
  family,
  familyKo: null,
  style: weight === 700 ? 'bold' : weight === 400 ? 'regular' : 'light',
  weight,
  italic: false,
  korean: true,
  variable: false,
  ...extra
})
const fams = groupFamilies([
  face('Zeta Serif', 300),
  face('Zeta Serif', 400, { familyKo: '제타 명조' }),
  face('Zeta Serif', 700),
  face('Zeta Serif', 400, { italic: true }),
  face('Only Light', 300),
  face('Latin Only', 400, { korean: false }),
  face('@Vertical', 400),
  face('Nanum Myeongjo', 400),
  face('Batang', 400, { familyKo: '바탕' })
])
const zeta = fams.find((f) => f.id === 'Zeta Serif')
check('보통 = 400에 가장 가까운 정자체', zeta?.regular.path === 'C:/f/Zeta Serif-400.ttf', JSON.stringify(zeta))
check('굵게 = 600 이상 중 700에 가까운 면', zeta?.bold?.path === 'C:/f/Zeta Serif-700.ttf')
check('한국어 이름이 라벨', zeta?.label === '제타 명조')
check('굵은 면이 없으면 bold=null', fams.find((f) => f.id === 'Only Light')?.bold === null)
check('한글 없는 글꼴·세로쓰기(@) 제외', !fams.some((f) => f.id === 'Latin Only' || f.id === '@Vertical'))
// 나눔명조처럼 Bold=600·ExtraBold=700이면 이름이 Bold인 면 / KoPub처럼 Regular가 없으면 Light보다 Medium
const nanum = groupFamilies([
  face('NanumMyeongjo', 400),
  face('NanumMyeongjo', 600, { style: 'bold', path: 'C:/f/NanumMyeongjoBold.ttf' }),
  face('NanumMyeongjo', 700, { style: 'extrabold', path: 'C:/f/NanumMyeongjoExtraBold.ttf' })
])[0]
check('굵게는 스타일 이름 Bold 우선 (ExtraBold 아님)', nanum?.bold?.path === 'C:/f/NanumMyeongjoBold.ttf', nanum?.bold?.path)
const kopub = groupFamilies([
  face('KoPubBatang_Pro', 300, { style: 'light', path: 'C:/f/light.otf' }),
  face('KoPubBatang_Pro', 500, { style: 'medium', path: 'C:/f/medium.otf' }),
  face('KoPubBatang_Pro', 700, { style: 'bold', path: 'C:/f/bold.otf' })
])[0]
check('Regular가 없으면 400에서 같은 거리면 무거운 쪽(Medium)', kopub?.regular.path === 'C:/f/medium.otf', kopub?.regular.path)
check('KoPub 바탕 별칭도 추천', kopub?.recommended === true)
const vf = groupFamilies([
  face('Noto Sans KR', 100, { variable: true, style: 'thin' }),
  face('Thin Static', 100, { style: 'thin' })
])
check('기본 굵기가 Thin인 가변 글꼴은 제외 (mupdf는 축을 못 바꿈)', !vf.some((f) => f.id === 'Noto Sans KR') && vf.some((f) => f.id === 'Thin Static'))
check('추천 글꼴이 먼저 (바탕 → 나눔명조 순)', fams[0]?.id === 'Batang' && fams[1]?.id === 'Nanum Myeongjo' && fams[0].recommended && !zeta?.recommended, fams.map((f) => f.id).join(', '))

// ── 실제 글꼴 폴더 훑기 ──
const t0 = Date.now()
const installed = await readingFontFamilies()
const ms = Date.now() - t0
check('설치된 한글 글꼴을 찾음', installed.length > 0, `${installed.length}개 / ${ms}ms`)
if (process.platform === 'win32') {
  const b = installed.find((f) => f.id === 'Batang')
  const m = installed.find((f) => f.id === 'Malgun Gothic')
  check('윈도우: 바탕·맑은 고딕 추천', !!b?.recommended && !!m?.recommended && b?.label === '바탕', JSON.stringify({ b, m }))
  check('맑은 고딕 굵게 = malgunbd.ttf', /malgunbd\.ttf$/i.test(m?.bold?.path ?? ''), m?.bold?.path)
}
check('두 번째 호출은 캐시', (await readingFontFamilies()) === installed)

// ── ③ mupdf에 실제로 걸기 ──
const pick = installed.find((f) => f.id === 'Batang') ?? installed[0]
const regular = new mupdf.Font(READING_FONT_FAMILY, readFileSync(pick.regular.path), pick.regular.index)
const asked: string[] = []
mupdf.installLoadFontFunction((name) => {
  asked.push(name)
  return name === READING_FONT_FAMILY ? regular : null
})
const bytes = readFileSync(epubPath)
const fontsOnPage = (doc: mupdf.Document, page: number): Set<string> => {
  const names = new Set<string>()
  doc.loadPage(page).toStructuredText('preserve-whitespace').walk({ onChar: (_c, _o, font) => void names.add(font.getName()) })
  return names
}
mupdf.setUserCSS('')
const plain = mupdf.Document.openDocument(bytes, 'application/epub+zip')
plain.layout(480, 680, 16)
const plainFonts = fontsOnPage(plain, 1)
mupdf.setUserCSS(readingFontCss())
const styled = mupdf.Document.openDocument(bytes, 'application/epub+zip')
styled.layout(480, 680, 16)
const styledFonts = fontsOnPage(styled, 1)
check('기본 = 책/내장 글꼴', !plainFonts.has(READING_FONT_FAMILY), [...plainFonts].join(', '))
check('CSS를 걸면 mupdf가 가상 가족 이름으로 요청', asked.includes(READING_FONT_FAMILY))
check(`본문이 고른 글꼴(${pick.label})로 배치`, styledFonts.size === 1 && styledFonts.has(READING_FONT_FAMILY), [...styledFonts].join(', '))
check('쪽 수가 정상 범위', styled.countPages() > 1, `${plain.countPages()} → ${styled.countPages()}`)
mupdf.setUserCSS('')

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
