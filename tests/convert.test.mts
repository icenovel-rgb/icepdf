/**
 * 변환 파이프라인 검증 (#10 이미지, #12 표) — Electron 없이 직접 모듈 호출.
 * 실행: npx tsx tests/convert.test.mts
 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { parsePdf, markdownToHwpx, parseHwpx } from 'kordoc'
import { blocksToMarkdownWithMarkers, pageMarker } from '../src/main/convert/blocks'
import { extractPageImages, renderPageImages } from '../src/main/convert/extract-images'
import { embedImagesIntoHwpx } from '../src/main/convert/hwpx'

const results: string[] = []
let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed++
}

async function buildHwpx(pdfPath: string): Promise<{ buffer: ArrayBuffer; imageCount: number; md: string }> {
  const buf = fs.readFileSync(pdfPath)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const parsed = await parsePdf(ab.slice(0))
  if (!parsed.success) throw new Error(parsed.error)
  const md = blocksToMarkdownWithMarkers(parsed.blocks as never, parsed.markdown)
  const hwpx0 = await markdownToHwpx(md.replace(/\n{3,}/g, '\n\n').trim())
  const images = extractPageImages(ab.slice(0))
  const { buffer, count } = await embedImagesIntoHwpx(hwpx0, images)
  return { buffer, imageCount: count, md }
}

async function sectionXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  return zip.file('Contents/section0.xml')!.async('string')
}

// ── #12: shopify (HTML 표) → 리터럴 태그 없어야 함 ──
{
  const { buffer, imageCount } = await buildHwpx('samples/shopify.pdf')
  const xml = await sectionXml(buffer)
  const texts = [...xml.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1])
  const leaked = texts.filter((t) => /&lt;\/?(table|td|tr|th)|&lt;br|^\|.*\|$/.test(t) || /<table|<td|<tr/.test(t))
  check('#12 shopify: HTML 표 리터럴 태그 없음', leaked.length === 0, leaked.length ? `누출 ${leaked.length}: ${JSON.stringify(leaked[0]).slice(0, 80)}` : 'clean')
  check('#12 shopify: 본문 텍스트 보존', xml.includes('쇼피파이') || xml.includes('Shopify'), '')
  check('#10 shopify: 이미지 임베드됨', imageCount > 0, `${imageCount}개`)
}

// ── #10: magazine (이미지 다수) → BinData + pic + 라운드트립 ──
{
  const { buffer, imageCount } = await buildHwpx('samples/magazine.pdf')
  const zip = await JSZip.loadAsync(buffer)
  const binFiles = Object.keys(zip.files).filter((f) => f.startsWith('BinData/') && !zip.files[f].dir)
  const xml = await sectionXml(buffer)
  const picCount = (xml.match(/<hp:pic\b/g) ?? []).length
  check('#10 magazine: 이미지 추출/임베드', imageCount > 5, `${imageCount}개`)
  check('#10 magazine: BinData 파일 생성', binFiles.length === imageCount, `${binFiles.length} files`)
  check('#10 magazine: hp:pic 요소 생성', picCount === imageCount, `${picCount} pics`)
  check('#10 magazine: hc 네임스페이스 선언', xml.includes('xmlns:hc'), '')
  check('#10 magazine: 페이지 마커 잔존 없음', !xml.includes('@@ICEPDFPG'), '')

  // 라운드트립: kordoc이 다시 이미지를 읽어내는가 (구조 정합성 증거)
  fs.mkdirSync('spike/output', { recursive: true })
  fs.writeFileSync('spike/output/magazine-images.hwpx', Buffer.from(buffer))
  const round = await parseHwpx(buffer)
  const rtImages = round.success ? round.images?.length ?? 0 : 0
  check('#10 magazine: kordoc 라운드트립 이미지 인식', round.success && rtImages > 0, `재인식 ${rtImages}개`)
}

// ── #H: 레이아웃 보존 — 각 페이지를 전면 이미지로 ──
{
  const buf = fs.readFileSync('samples/korean.pdf')
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const pages = renderPageImages(ab.slice(0))
  const markers = pages.map((p) => pageMarker(p.page)).join('\n\n')
  const skeleton = await markdownToHwpx(markers)
  const { buffer, count } = await embedImagesIntoHwpx(skeleton, pages)
  const zip = await JSZip.loadAsync(buffer)
  const bin = Object.keys(zip.files).filter((f) => f.startsWith('BinData/') && !zip.files[f].dir)
  const xml = await zip.file('Contents/section0.xml')!.async('string')
  const pics = (xml.match(/<hp:pic\b/g) ?? []).length
  check('#H 레이아웃: 페이지=전면 이미지', count === pages.length && bin.length === pages.length && pics === pages.length, `${pages.length}p → pic ${pics}`)
  check('#H 레이아웃: 마커 잔존 없음', !xml.includes('@@ICEPDFPG'), '')
  const round = await parseHwpx(buffer)
  check('#H 레이아웃: kordoc 라운드트립', round.success && (round.images?.length ?? 0) === pages.length, `재인식 ${round.success ? round.images?.length : 0}`)
}

console.log(results.join('\n'))
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
