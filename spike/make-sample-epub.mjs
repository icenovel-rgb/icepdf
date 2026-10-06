/** 테스트용 샘플 EPUB 생성 — 한글 3장, 중첩 목차(NCX+nav), 내부/외부 링크, 폰트 미내장 */
import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outPath = path.join(root, 'samples', 'sample.epub')

const TITLE = '얼음 소설 샘플'
const CHAPTERS = [
  { file: 'ch1.xhtml', title: '제1장 겨울의 시작', line: '차가운 바람이 마을을 휘감았다. 아이는 창밖을 바라보며 첫눈을 기다렸다' },
  { file: 'ch2.xhtml', title: '제2장 눈 내리는 밤', line: '밤새 눈이 내렸다. 골목마다 하얀 발자국이 이어졌고 아무도 말이 없었다' },
  { file: 'ch3.xhtml', title: '제3장 봄을 기다리며', line: '얼음이 녹기 시작했다. 개울물 소리가 다시 들려왔다' }
]
const PARAS = 24

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">icepdf-sample-epub</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:language>ko</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${CHAPTERS.map((c, i) => `    <item id="c${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${CHAPTERS.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join('\n')}
  </spine>
</package>`

// 2장 아래에 하위 항목(앵커) — 중첩 목차 검증용
const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="icepdf-sample-epub"/></head>
  <docTitle><text>${TITLE}</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>${CHAPTERS[0].title}</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>${CHAPTERS[1].title}</text></navLabel><content src="ch2.xhtml"/>
      <navPoint id="n2a" playOrder="3"><navLabel><text>새벽의 발자국</text></navLabel><content src="ch2.xhtml#dawn"/></navPoint>
    </navPoint>
    <navPoint id="n3" playOrder="4"><navLabel><text>${CHAPTERS[2].title}</text></navLabel><content src="ch3.xhtml"/></navPoint>
  </navMap>
</ncx>`

const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>목차</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">${CHAPTERS[0].title}</a></li>
<li><a href="ch2.xhtml">${CHAPTERS[1].title}</a><ol><li><a href="ch2.xhtml#dawn">새벽의 발자국</a></li></ol></li>
<li><a href="ch3.xhtml">${CHAPTERS[2].title}</a></li>
</ol></nav></body></html>`

function chapterHtml(c, idx) {
  const paras = []
  for (let i = 0; i < PARAS; i++) {
    // 2장 중간에 앵커 — 목차 하위 항목 목적지
    const id = idx === 1 && i === PARAS / 2 ? ' id="dawn"' : ''
    paras.push(`<p${id}>${c.line} (${i + 1}번째 문단) Snowflake 펭귄.</p>`)
  }
  const next = CHAPTERS[idx + 1]
  const links = [
    next ? `<a href="${next.file}">다음 장으로</a>` : '',
    '<a href="https://icenovel.com">홈페이지</a>'
  ].filter(Boolean).join(' · ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${c.title}</title></head>
<body><h1>${c.title}</h1>
${paras.join('\n')}
<p>${links}</p>
</body></html>`
}

const zip = new JSZip()
// mimetype은 반드시 첫 항목 + 무압축 (EPUB OCF 규격)
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.file('META-INF/container.xml', container)
zip.file('OEBPS/content.opf', opf)
zip.file('OEBPS/toc.ncx', ncx)
zip.file('OEBPS/nav.xhtml', nav)
CHAPTERS.forEach((c, i) => zip.file(`OEBPS/${c.file}`, chapterHtml(c, i)))

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, buf)
console.log(`샘플 EPUB 생성: ${outPath} (${buf.length} bytes)`)
