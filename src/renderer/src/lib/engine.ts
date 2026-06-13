/**
 * 엔진 호출 래퍼 — 활성 탭의 docId를 자동 주입한다.
 * 모든 뷰는 활성 문서만 표시하므로 호출부는 docId를 신경 쓰지 않는다.
 */
import { useStore } from '../state/store'
import type { EngineOpName, EngineOps } from '../../../shared/types'

export function eng<K extends EngineOpName>(
  op: K,
  args: EngineOps[K]['args']
): Promise<EngineOps[K]['result']> {
  return window.icepdf.engine(useStore.getState().activeDocId, op, args)
}
