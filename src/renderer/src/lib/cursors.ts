/** 커스텀 마우스 커서 (data-URI SVG) — 지우개(#B), 회전(#C) */

function cur(svg: string, hotX: number, hotY: number, fallback: string): string {
  const enc = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')
  return `url("data:image/svg+xml,${enc}") ${hotX} ${hotY}, ${fallback}`
}

const ERASER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
<g fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"><path d="M7 22l-4-4a2 2 0 0 1 0-3L14 4a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L11 23"/><path d="M22 22H7"/></g>
<g fill="none" stroke="#222" stroke-width="1.4" stroke-linejoin="round"><path d="M7 22l-4-4a2 2 0 0 1 0-3L14 4a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L11 23"/><path d="M22 22H7"/></g></svg>`

const ROTATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
<g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 14a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></g>
<g fill="none" stroke="#222" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 14a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></g></svg>`

export const CURSOR_ERASER = cur(ERASER_SVG, 4, 22, 'crosshair')
export const CURSOR_ROTATE = cur(ROTATE_SVG, 14, 14, 'grab')
