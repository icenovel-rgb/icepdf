/**
 * OCR 워커 — tesseract.js로 페이지 이미지에서 텍스트 추출 (#III).
 * 코어 wasm은 node_modules(tesseract.js-core)에서 로드, 언어데이터는 첫 사용 시
 * 다운로드되어 cachePath에 캐시된다(이후 오프라인). tesseract 워커는 재사용.
 */
import { parentPort } from 'node:worker_threads'
import { createWorker, type Worker as TWorker } from 'tesseract.js'

interface OcrRequest {
  id: number
  png: ArrayBuffer
  cachePath: string
  lang: string
}

let tw: TWorker | null = null
let twLang = ''

async function getWorker(lang: string, cachePath: string): Promise<TWorker> {
  if (tw && twLang === lang) return tw
  if (tw) {
    await tw.terminate()
    tw = null
  }
  tw = await createWorker(lang, 1, { cachePath })
  twLang = lang
  return tw
}

interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/** data.words 또는 blocks 트리에서 단어+bbox 평탄화 */
function flattenWords(data: any): OcrWord[] {
  const out: OcrWord[] = []
  const push = (w: any): void => {
    if (w?.text && w.bbox) out.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
  }
  if (Array.isArray(data?.words) && data.words.length) {
    data.words.forEach(push)
    return out
  }
  for (const b of data?.blocks ?? []) {
    for (const p of b?.paragraphs ?? []) {
      for (const l of p?.lines ?? []) {
        for (const w of l?.words ?? []) push(w)
      }
    }
  }
  return out
}

parentPort?.on('message', async (msg: OcrRequest) => {
  try {
    const w = await getWorker(msg.lang, msg.cachePath)
    const { data } = await w.recognize(Buffer.from(msg.png), {}, { text: true, blocks: true })
    parentPort?.postMessage({ id: msg.id, ok: true, result: { text: data.text, words: flattenWords(data) } })
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
