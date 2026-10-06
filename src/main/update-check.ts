/** 새 버전 확인 (메인 프로세스) — GitHub Releases의 최신 릴리스를 읽어 현재 버전과 비교한다. */
import { app, net } from 'electron'
import {
  LATEST_RELEASE_API,
  isNewerVersion,
  parseLatestRelease,
  type UpdateCheckResult
} from '../shared/version'

const TIMEOUT_MS = 8000

/** 테스트 전용 — e2e가 로컬 가짜 서버로 GitHub 응답을 흉내 낼 때 (사용자 설정 아님) */
function endpoint(): string {
  return process.env.ICEPDF_UPDATE_URL || LATEST_RELEASE_API
}

/**
 * auto=true(실행 시 자동 확인)는 설치본에서만 — 개발 실행·e2e가 GitHub에 요청하지 않게.
 * ICEPDF_UPDATE_URL을 주면 개발 실행에서도 확인, ICEPDF_NO_UPDATE_CHECK면 자동 확인 끔.
 * 수동 확인(메뉴)은 언제나 실행. 네트워크 실패는 error로 돌려주고 던지지 않는다.
 */
export async function checkForUpdate(auto: boolean): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const testServer = !!process.env.ICEPDF_UPDATE_URL
  if (auto && ((!app.isPackaged && !testServer) || process.env.ICEPDF_NO_UPDATE_CHECK)) {
    return { status: 'skipped', current }
  }
  try {
    const res = await net.fetch(endpoint(), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ICEPDF/${current}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    // 릴리스가 아직 하나도 없으면 GitHub이 404 — 새 버전 없음으로 본다
    if (res.status === 404) return { status: 'latest', current }
    if (!res.ok) return { status: 'error', current, message: `HTTP ${res.status}` }
    const latest = parseLatestRelease(await res.json())
    if (!latest) return { status: 'error', current, message: '릴리스 정보를 해석할 수 없습니다' }
    return isNewerVersion(latest.version, current)
      ? { status: 'available', current, latest }
      : { status: 'latest', current }
  } catch (err) {
    return { status: 'error', current, message: err instanceof Error ? err.message : String(err) }
  }
}
