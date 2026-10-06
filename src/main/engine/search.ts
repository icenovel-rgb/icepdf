/** 찾기(Ctrl+F) — 쪽 구간 단위 검색. 대소문자 무시는 mupdf 기본 동작. */
import type * as mupdf from 'mupdf'
import type { Quad, SearchHit } from '../../shared/types'

/**
 * [from, to) 쪽에서 needle을 찾는다. 결과는 쪽 순서이며 maxHits에서 멈춘다.
 * 페이지 구조화 텍스트를 캐시하지 않는다 — 전 쪽을 훑는 검색이 캐시에 남으면
 * 큰 문서에서 wasm 메모리가 불어난다(선택용 캐시와 분리).
 */
export function searchPages(
  doc: mupdf.Document,
  needle: string,
  from: number,
  to: number,
  maxHits: number
): { hits: SearchHit[] } {
  const hits: SearchHit[] = []
  if (!needle) return { hits }
  const end = Math.min(to, doc.countPages())
  for (let i = Math.max(0, from); i < end && hits.length < maxHits; i++) {
    const page = doc.loadPage(i)
    try {
      const found = page.search(needle, maxHits - hits.length) as unknown as Quad[][]
      for (const quads of found) {
        hits.push({ page: i, quads: quads.map((q) => Array.from(q)) })
        if (hits.length >= maxHits) break
      }
    } finally {
      page.destroy()
    }
  }
  return { hits }
}
