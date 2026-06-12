/** 이번 세션에 삽입한 이미지의 편집 상태 레지스트리 — 재선택 시 회전/반전/원본 복원 (#9) */
import type { SelectedImage } from '../state/store'

export type SessionImage = Omit<SelectedImage, 'page' | 'index' | 'rect'>

const registry = new Map<string, SessionImage>()
const key = (page: number, index: number): string => `${page}:${index}`

export function registerSessionImage(sel: SelectedImage): void {
  registry.set(key(sel.page, sel.index), {
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

export function getSessionImage(page: number, index: number): SessionImage | undefined {
  return registry.get(key(page, index))
}

export function clearSessionImages(): void {
  registry.clear()
}
