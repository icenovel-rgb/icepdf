/**
 * kordoc 변환 워커 — PDF 버퍼를 Markdown / HWPX(텍스트+이미지) / HWPX(레이아웃 보존)로 변환.
 * - 표: IRBlock에서 파이프 표로 재구성해 HTML 표 리터럴 잔존 방지 (#12)
 * - 이미지: mupdf로 추출해 HWPX에 임베드 / Markdown에 첨부 (#10)
 * - 레이아웃 보존: 각 페이지를 전면 이미지로 임베드 (#H)
 */
import { parentPort } from 'node:worker_threads'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, dirname, extname } from 'node:path'
import { parsePdf, markdownToHwpx } from 'kordoc'
import { blocksToMarkdownWithMarkers, type IRBlock } from './blocks'
import { extractPageImages, renderPageImages, type PageImage } from './extract-images'
import { embedImagesIntoHwpx } from './hwpx'

type Mode = 'markdown' | 'hwpx' | 'images'

interface ConvertRequest {
  id: number
  mode: Mode
  pdf: ArrayBuffer
  outPath: string
}

function stripMarkers(md: string): string {
  return md.replace(/@@ICEPDFPG\d{4}@@/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function groupByPage(images: PageImage[]): Map<number, PageImage[]> {
  const m = new Map<number, PageImage[]>()
  for (const im of images) {
    const l = m.get(im.page)
    if (l) l.push(im)
    else m.set(im.page, [im])
  }
  return m
}

async function run(msg: ConvertRequest): Promise<{ outPath: string; imageCount: number; warnings: string[] }> {
  const warnings: string[] = []

  // ── 폴더에 페이지 이미지로 내보내기 ──
  if (msg.mode === 'images') {
    mkdirSync(msg.outPath, { recursive: true })
    const pages = renderPageImages(msg.pdf, 160)
    for (const p of pages) {
      writeFileSync(join(msg.outPath, `page_${String(p.page).padStart(3, '0')}.png`), p.png)
    }
    return { outPath: msg.outPath, imageCount: pages.length, warnings }
  }

  // ── 텍스트 + 표 + 이미지 ──
  const pdfForImages = msg.pdf.slice(0)
  const parsed = await parsePdf(msg.pdf)
  if (!parsed.success) throw new Error(`PDF 파싱 실패: ${parsed.error}`)

  for (const w of parsed.warnings ?? []) {
    warnings.push(typeof w === 'string' ? w : (w as { message?: string }).message ?? JSON.stringify(w))
  }
  if (parsed.isImageBased) warnings.push('이미지 기반 PDF입니다 — 추출된 텍스트가 거의 없을 수 있습니다.')

  const mdWithMarkers = blocksToMarkdownWithMarkers(
    parsed.blocks as unknown as IRBlock[] | undefined,
    parsed.markdown
  )

  let images: PageImage[] = []
  try {
    images = extractPageImages(pdfForImages)
  } catch (err) {
    warnings.push(`이미지 추출 실패: ${err instanceof Error ? err.message : err}`)
  }

  if (msg.mode === 'markdown') {
    let md = mdWithMarkers
    let imageCount = 0
    if (images.length) {
      const assetDirName = `${basename(msg.outPath, extname(msg.outPath))}.assets`
      const assetDir = join(dirname(msg.outPath), assetDirName)
      mkdirSync(assetDir, { recursive: true })
      const byPage = groupByPage(images)
      const nameOf = new Map<PageImage, string>()
      images.forEach((im, i) => {
        const name = `image_${String(i + 1).padStart(3, '0')}.png`
        writeFileSync(join(assetDir, name), im.png)
        nameOf.set(im, name)
        imageCount++
      })
      md = md.replace(/@@ICEPDFPG(\d{4})@@/g, (_m, pg: string) => {
        const list = byPage.get(parseInt(pg, 10)) ?? []
        return list.map((im) => `![](${assetDirName}/${nameOf.get(im)})`).join('\n\n')
      })
    }
    writeFileSync(msg.outPath, stripMarkers(md), 'utf-8')
    return { outPath: msg.outPath, imageCount, warnings }
  }

  // hwpx
  const hwpx0 = await markdownToHwpx(mdWithMarkers.replace(/\n{3,}/g, '\n\n').trim())
  try {
    const { buffer, count } = await embedImagesIntoHwpx(hwpx0, images)
    writeFileSync(msg.outPath, Buffer.from(buffer))
    return { outPath: msg.outPath, imageCount: count, warnings }
  } catch (err) {
    const fallback = await markdownToHwpx(stripMarkers(mdWithMarkers))
    writeFileSync(msg.outPath, Buffer.from(fallback))
    warnings.push(`이미지 임베드 실패(텍스트만 저장): ${err instanceof Error ? err.message : err}`)
    return { outPath: msg.outPath, imageCount: 0, warnings }
  }
}

parentPort?.on('message', async (msg: ConvertRequest) => {
  try {
    const r = await run(msg)
    parentPort?.postMessage({ id: msg.id, ok: true, result: { ok: true, ...r } })
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
