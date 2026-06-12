/**
 * kordoc가 생성한 HWPX(텍스트+표)에 mupdf로 추출한 이미지를 임베드한다 (#10).
 * - BinData/imageN.png 추가
 * - content.hpf 매니페스트에 item 등록 (binaryItemIDRef가 가리키는 대상)
 * - section0.xml의 페이지 마커 문단을 해당 페이지 이미지 <hp:pic> 문단으로 치환
 * markdownToHwpx가 이미지를 지원하지 않으므로 후처리 방식을 택했다.
 */
import JSZip from 'jszip'
import type { PageImage } from './extract-images'

const HC_NS = 'http://www.hancom.co.kr/hwpml/2011/core'
const PT_TO_HWP = 100 // 1 PDF pt = 1/72 inch = 100 HWPUNIT(1/7200 inch)
const MAX_W = 45000 // 본문 폭(≈49606) 안쪽으로 제한
const MAX_H = 62000

interface Placed {
  page: number
  ref: string
  id: number
  w: number
  h: number
}

function fitSize(im: PageImage): [number, number] {
  let w = Math.max(1, Math.round((im.ptWidth || 100) * PT_TO_HWP))
  let h = Math.max(1, Math.round((im.ptHeight || 100) * PT_TO_HWP))
  if (w > MAX_W) {
    h = Math.round((h * MAX_W) / w)
    w = MAX_W
  }
  if (h > MAX_H) {
    w = Math.round((w * MAX_H) / h)
    h = MAX_H
  }
  return [w, h]
}

function picXml(p: Placed, z: number): string {
  const { ref, id, w, h } = p
  const cx = Math.round(w / 2)
  const cy = Math.round(h / 2)
  return (
    `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">` +
    `<hp:pic reverse="0" id="${id}" zOrder="${z}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}">` +
    `<hp:offset x="0" y="0"/>` +
    `<hp:orgSz width="${w}" height="${h}"/>` +
    `<hp:curSz width="${w}" height="${h}"/>` +
    `<hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${cx}" centerY="${cy}" rotateimage="1"/>` +
    `<hp:renderingInfo>` +
    `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
    `</hp:renderingInfo>` +
    `<hc:img binaryItemIDRef="${ref}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:imgDim dimwidth="${w}" dimheight="${h}"/>` +
    `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `</hp:pic></hp:run></hp:p>`
  )
}

export async function embedImagesIntoHwpx(
  hwpx: ArrayBuffer,
  images: PageImage[]
): Promise<{ buffer: ArrayBuffer; count: number }> {
  if (!images.length) return { buffer: hwpx, count: 0 }

  const zip = await JSZip.loadAsync(hwpx)

  // 문서 순서대로 id/ref 배정 + BinData 기록
  const placed: Placed[] = []
  const byPage = new Map<number, Placed[]>()
  const manifestItems: string[] = []
  images.forEach((im, i) => {
    const id = i + 1
    const ref = `image${id}`
    zip.file(`BinData/${ref}.png`, im.png)
    manifestItems.push(
      `    <opf:item id="${ref}" href="BinData/${ref}.png" media-type="image/png" isEmbeded="1"/>`
    )
    const [w, h] = fitSize(im)
    const p: Placed = { page: im.page, ref, id, w, h }
    placed.push(p)
    const list = byPage.get(im.page)
    if (list) list.push(p)
    else byPage.set(im.page, [p])
  })

  // 매니페스트 등록
  let hpf = await zip.file('Contents/content.hpf')!.async('string')
  hpf = hpf.replace('</opf:manifest>', `${manifestItems.join('\n')}\n  </opf:manifest>`)
  zip.file('Contents/content.hpf', hpf)

  // 섹션 XML: hc 네임스페이스 보장 + 마커 치환
  let sec = await zip.file('Contents/section0.xml')!.async('string')
  if (!sec.includes('xmlns:hc')) {
    sec = sec.replace('<hs:sec ', `<hs:sec xmlns:hc="${HC_NS}" `)
  }
  let z = 1
  const consumed = new Set<number>()
  const markerPara = /<hp:p\b[^>]*>(?:(?!<\/hp:p>)[\s\S])*?@@ICEPDFPG(\d{4})@@(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>/g
  sec = sec.replace(markerPara, (_m, pg: string) => {
    const page = parseInt(pg, 10)
    consumed.add(page)
    const list = byPage.get(page)
    if (!list?.length) return ''
    return list.map((p) => picXml(p, z++)).join('')
  })
  // 이미지가 없어 남은 마커 문단 제거
  sec = sec.replace(
    /<hp:p\b[^>]*>(?:(?!<\/hp:p>)[\s\S])*?@@ICEPDFPG\d{4}@@(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>/g,
    ''
  )

  // 텍스트 블록이 없어 마커가 없던 페이지(이미지 전용 페이지)의 이미지를 문서 끝에 보존
  const leftover = placed
    .filter((p) => !consumed.has(p.page))
    .sort((a, b) => a.page - b.page || a.id - b.id)
  if (leftover.length) {
    const tail = leftover.map((p) => picXml(p, z++)).join('')
    sec = sec.replace('</hs:sec>', `${tail}</hs:sec>`)
  }
  zip.file('Contents/section0.xml', sec)

  const buffer = await zip.generateAsync({ type: 'arraybuffer' })
  return { buffer, count: placed.length }
}
