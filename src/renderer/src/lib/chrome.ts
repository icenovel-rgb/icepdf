/**
 * 도구(크롬: 탭 막대·툴바·사이드바·상태바) 숨기기 — 전체화면이 아니어도 숨길 수 있고,
 * 숨긴 동안 창 위쪽 끝에 마우스를 대면 탭 막대·툴바가 잠깐 나타난다(chromePeek).
 */
import { useStore } from '../state/store'

const store = (): ReturnType<typeof useStore.getState> => useStore.getState()

/** Tab·메뉴·툴바 버튼: 도구 숨김/표시 */
export function toggleChrome(): void {
  const s = store()
  if (!s.info) return
  s.set({ chromeHidden: !s.chromeHidden, chromePeek: false })
}

/** Ctrl+L: 도구 숨김 + 창 전체화면 */
export function toggleFullscreen(): void {
  const s = store()
  const next = !s.fullscreen
  s.set({ fullscreen: next, chromeHidden: next, chromePeek: false })
  void window.icepdf.setFullScreen(next)
}

/** Esc: 전체화면·도구 숨김 해제 */
export function exitChrome(): void {
  const s = store()
  if (s.fullscreen) void window.icepdf.setFullScreen(false)
  s.set({ chromeHidden: false, fullscreen: false, chromePeek: false })
}
