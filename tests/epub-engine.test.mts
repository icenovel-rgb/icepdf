/**
 * 엔진 통합 검증 (실제 mupdf) — EPUB 열기·리플로우·목차·검색(구간 분할)·EPUB→PDF 변환.
 * 샘플: samples/sample.epub (spike/make-sample-epub.mjs), samples/sample.pdf
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import JSZip from 'jszip'
import { openEngineDoc, relayoutEpub } from '../src/main/engine/open'
import { readOutline } from '../src/main/engine/outline'
import { searchPages } from '../src/main/engine/search'
import { reflowableToPdf } from '../src/main/engine/reflow-to-pdf'
import { EPUB_FONT } from '../src/shared/doc-kind'
import type { BookmarkItem } from '../src/shared/types'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const epubPath = path.join(root, 'samples', 'sample.epub')
const pdfPath = path.join(root, 'samples', 'sample.pdf')

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}
const count = (doc: mupdf.Document, needle: string): number =>
  searchPages(doc, needle, 0, doc.countPages(), 100000).hits.length

// ── 열기 ──
const epub = openEngineDoc(epubPath, readFileSync(epubPath))
check('EPUB 열기 → kind=epub', epub.kind === 'epub')
check('EPUB은 편집용 PDF 핸들 없음(읽기 전용)', epub.pdf === null)
check('EPUB 기본 글자 크기', epub.fontSize === EPUB_FONT.default, `${epub.fontSize}`)
const n0 = epub.doc.countPages()
check('EPUB 여러 쪽으로 레이아웃', n0 > 1, `${n0}쪽`)

const pdf = openEngineDoc(pdfPath, readFileSync(pdfPath))
check('PDF 열기 → kind=pdf + 편집 핸들', pdf.kind === 'pdf' && pdf.pdf !== null)
check('PDF는 글자 크기 없음', pdf.fontSize === null)

// ── 목차 (중첩 유지) ──
const toc = readOutline(epub.doc)
check('목차 최상위 3장', toc.length === 3, toc.map((t) => t.title).join(' | '))
check('2장 하위 항목 1개', toc[1]?.children.length === 1 && toc[1].children[0].title === '새벽의 발자국')
check('하위 항목은 2장 이후 쪽', (toc[1]?.children[0]?.page ?? -1) >= (toc[1]?.page ?? 99))
check('장 순서대로 쪽 증가', toc[0].page < toc[1].page && toc[1].page < toc[2].page, toc.map((t) => t.page).join(','))

// ── 검색 (구간 분할 = 전체, 대소문자 무시, 상한) ──
const total = count(epub.doc, 'Snowflake')
check('Snowflake 72건 (3장×24문단)', total === 72, `${total}`)
check('대소문자 무시 (snowflake)', count(epub.doc, 'snowflake') === total)
check('한글 검색 (펭귄) 결과 있음', count(epub.doc, '펭귄') > 0)
const half = Math.floor(n0 / 2)
const a = searchPages(epub.doc, 'Snowflake', 0, half, 100000).hits
const b = searchPages(epub.doc, 'Snowflake', half, n0, 100000).hits
check('구간 분할 합 = 전체', a.length + b.length === total, `${a.length}+${b.length}`)
check('구간 결과는 그 구간 쪽만', a.every((h) => h.page < half) && b.every((h) => h.page >= half))
check('결과는 쪽 순서', [...a, ...b].every((h, i, arr) => i === 0 || arr[i - 1].page <= h.page))
check('상한(maxHits) 적용', searchPages(epub.doc, 'Snowflake', 0, n0, 5).hits.length === 5)
check('범위 밖 to는 잘림', searchPages(epub.doc, 'Snowflake', 0, n0 + 50, 100000).hits.length === total)
check('결과마다 쿼드(8개 좌표)', a[0]?.quads[0]?.length === 8)
check('PDF 검색 (fox)', count(pdf.doc, 'fox') > 0, `${count(pdf.doc, 'fox')}`)

// ── 리플로우 (글자 크게 → 쪽 증가, 목차 쪽 재계산) ──
relayoutEpub(epub.doc, EPUB_FONT.default + 8)
const n1 = epub.doc.countPages()
check('글자 키우면 쪽수 증가', n1 > n0, `${n0} → ${n1}`)
const toc1 = readOutline(epub.doc)
check('리플로우 후 목차 쪽 재계산', toc1[2].page > toc[2].page, `${toc[2].page} → ${toc1[2].page}`)
check('리플로우 후에도 검색 결과 동일', count(epub.doc, 'Snowflake') === total)
relayoutEpub(epub.doc, EPUB_FONT.default)
check('원래 크기로 되돌리면 쪽수 복귀', epub.doc.countPages() === n0)

// ── EPUB → PDF 변환 ──
const bytes = reflowableToPdf(epub.doc, '얼음 소설 샘플')
check('변환 결과 PDF 시그니처', String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-')
check('폰트 서브셋 — 300KB 미만', bytes.length < 300 * 1024, `${Math.round(bytes.length / 1024)}KB`)
const out = mupdf.Document.openDocument(bytes, 'application/pdf')
check('변환 PDF 쪽수 = EPUB 쪽수', out.countPages() === n0, `${out.countPages()}/${n0}`)
check('변환 PDF 제목 메타데이터', out.getMetaData('info:Title') === '얼음 소설 샘플')
check('변환 PDF 텍스트 검색 가능 (Snowflake)', count(out, 'Snowflake') === total)
check('변환 PDF 한글 검색 가능 (펭귄)', count(out, '펭귄') === count(epub.doc, '펭귄'))

const outToc = readOutline(out)
const shape = (items: BookmarkItem[]): unknown => items.map((i) => [i.title, i.page, shape(i.children)])
check('변환 PDF 목차(중첩·쪽) 보존', JSON.stringify(shape(outToc)) === JSON.stringify(shape(toc)), JSON.stringify(shape(outToc)))

// 링크: 원본 각 쪽의 링크 수·외부 URL·내부 목적지가 그대로
let srcLinks = 0
let okLinks = 0
for (let i = 0; i < n0; i++) {
  const sl = epub.doc.loadPage(i).getLinks()
  const ol = out.loadPage(i).getLinks()
  srcLinks += sl.length
  sl.forEach((l, k) => {
    const o = ol[k]
    if (!o) return
    const same = l.isExternal()
      ? o.isExternal() && o.getURI() === l.getURI()
      : !o.isExternal() && out.resolveLink(o) === epub.doc.resolveLink(l)
    if (same) okLinks++
  })
}
check('원본에 링크 존재', srcLinks > 0, `${srcLinks}개`)
check('링크 전부 보존(외부 URL·내부 목적지)', okLinks === srcLinks, `${okLinks}/${srcLinks}`)

// 변환은 원본 레이아웃을 건드리지 않음
check('변환 후 EPUB 쪽수 그대로', epub.doc.countPages() === n0)

// ── 큰 EPUB(수백 쪽) 변환 — 서브셋 전 PDF가 커서 wasm 메모리 증가가 일어나는 규모 ──
// (변환 중간 PDF를 wasm 뷰로 넘기면 메모리 증가 시 detach되는 위험 — Buffer를 직접 넘겨야 함)
{
  const CH = 200
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  const items: string[] = []
  const refs: string[] = []
  for (let i = 0; i < CH; i++) {
    items.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
    refs.push(`<itemref idref="c${i}"/>`)
    const paras = Array.from({ length: 40 }, (_, k) => `<p>${i}장 ${k}문단 차가운 바람 펭귄 lorem ipsum dolor sit amet.</p>`).join('')
    zip.file(`c${i}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${i}장</h1>${paras}</body></html>`)
  }
  zip.file('c.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">big</dc:identifier><dc:title>큰 책</dc:title></metadata><manifest>${items.join('')}</manifest><spine>${refs.join('')}</spine></package>`)
  const big = openEngineDoc('big.epub', await zip.generateAsync({ type: 'uint8array' }))
  const bigPages = big.doc.countPages()
  let bigOut: Uint8Array | null = null
  try {
    bigOut = reflowableToPdf(big.doc, '큰 책')
  } catch (err) {
    console.log('  변환 오류:', err instanceof Error ? err.message : err)
  }
  check('큰 EPUB 수백 쪽', bigPages >= 500, `${bigPages}쪽`)
  check('큰 EPUB → PDF 변환 성공', bigOut !== null)
  if (bigOut) {
    const re = mupdf.Document.openDocument(bigOut, 'application/pdf')
    check('큰 변환 PDF 쪽수 일치', re.countPages() === bigPages)
    check('큰 변환 PDF 마지막 쪽 검색 가능', searchPages(re, '펭귄', bigPages - 1, bigPages, 100).hits.length > 0)
    check('큰 변환 PDF 1MB 미만(서브셋)', bigOut.length < 1024 * 1024, `${Math.round(bigOut.length / 1024)}KB`)
  }
}

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
