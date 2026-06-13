/** 이번 세션에 삽입한 이미지의 편집 상태 레지스트리 — 재선택 시 회전/반전/원본 복원 (#9). 탭(docId)별 분리. */
import type { SelectedImage } from '../state/store'

export type SessionImage = Omit<SelectedImage, 'page' | 'index' | 'rect'>

const registry = new Map<string, SessionImage>()
const key = (docId: number, page: number, index: number): string => `${docId}:${page}:${index}`

export function registerSessionImage(docId: number, sel: SelectedImage): void {
  registry.set(key(docId, sel.page, sel.index), {
    origData: sel.origData,
    naturalW: sel.naturalW,
    naturalH: sel.naturalH,
    cx: sel.cx,
    cy: sel.cy,
    w0: sel.w0,
    h0: sel.h0,
    rotation: sel.rotation,
    flipH: sel.flipH,
    flipV: sel.flipV
  })
}

export function getSessionImage(docId: number, page: number, index: number): SessionImage | undefined {
  return registry.get(key(docId, page, index))
}

/** 해당 문서(docId)의 항목만 비운다 — 페이지 구조 변경 시 */
export function clearSessionImages(docId: number): void {
  const prefix = `${docId}:`
  for (const k of registry.keys()) {
    if (k.startsWith(prefix)) registry.delete(k)
  }
}
