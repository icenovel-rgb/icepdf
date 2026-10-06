/** 새 버전 알림 — 실행 시 자동 확인(조용히) / 메뉴 "업데이트 확인"(결과를 항상 알려줌) */
import { useStore } from '../state/store'

/** 실행 직후 확인을 미루는 시간 — 문서 열기·첫 렌더를 방해하지 않게 */
export const AUTO_CHECK_DELAY = 3000

export async function runUpdateCheck(manual: boolean): Promise<void> {
  const s = useStore.getState()
  const r = await window.icepdf.checkUpdate(!manual)
  useStore.getState().set({ appVersion: r.current })
  if (r.status === 'available') {
    useStore.getState().set({ update: r.latest })
    return
  }
  // 자동 확인은 새 버전이 있을 때만 알린다 (최신·실패·생략은 조용히)
  if (!manual) return
  if (r.status === 'error') s.showToast(`업데이트 확인 실패: ${r.message}`)
  else s.showToast(`최신 버전을 사용 중입니다 (v${r.current})`)
}
