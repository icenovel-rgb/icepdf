/** 새 버전 알림 — 버전 비교·GitHub 최신 릴리스 응답 검증 단위 테스트 */
import { compareVersions, isNewerVersion, parseLatestRelease, RELEASES_PAGE_PREFIX } from '../src/shared/version'

let fail = 0
const check = (n: string, cond: boolean, d = ''): void => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`)
  if (!cond) fail++
}

// ── 버전 비교 (v 접두사 허용, 숫자 단위 비교 — 문자열 비교면 1.10 < 1.9 로 틀림) ──
check('1.9.0 > 1.8.0', isNewerVersion('1.9.0', '1.8.0'))
check('v1.9.0 > 1.8.0 (v 접두사)', isNewerVersion('v1.9.0', '1.8.0'))
check('1.10.0 > 1.9.0 (숫자 비교)', isNewerVersion('1.10.0', '1.9.0'))
check('2.0.0 > 1.99.99', isNewerVersion('2.0.0', '1.99.99'))
check('1.8.1 > 1.8.0', isNewerVersion('1.8.1', '1.8.0'))
check('같은 버전 → 새 버전 아님', !isNewerVersion('1.9.0', '1.9.0'))
check('더 낮은 버전 → 새 버전 아님', !isNewerVersion('1.7.0', '1.9.0'))
check('자리수 다름 (1.9 = 1.9.0)', compareVersions('1.9', '1.9.0') === 0)
check('형식 오류 → 새 버전 아님', !isNewerVersion('latest', '1.9.0') && !isNewerVersion('', '1.9.0'))
check('사전 릴리스 꼬리표 무시 (1.9.0-beta → 1.9.0)', compareVersions('1.9.0-beta.1', '1.9.0') === 0)

// ── GitHub /releases/latest 응답 검증 ──
const good = {
  tag_name: 'v1.9.0',
  html_url: `${RELEASES_PAGE_PREFIX}tag/v1.9.0`,
  draft: false,
  prerelease: false,
  name: 'ICEPDF v1.9.0'
}
const r = parseLatestRelease(good)
check('정상 응답 → 버전·주소', r?.version === '1.9.0' && r.url === good.html_url, JSON.stringify(r))
check('초안(draft) 무시', parseLatestRelease({ ...good, draft: true }) === null)
check('사전 릴리스(prerelease) 무시', parseLatestRelease({ ...good, prerelease: true }) === null)
check('다른 저장소 주소 거부 (피싱 방지)', parseLatestRelease({ ...good, html_url: 'https://github.com/evil/icepdf/releases/tag/v1.9.0' }) === null)
check('http 주소 거부', parseLatestRelease({ ...good, html_url: good.html_url.replace('https', 'http') }) === null)
check('태그 형식 오류 거부', parseLatestRelease({ ...good, tag_name: 'nightly' }) === null)
check('필드 누락 거부', parseLatestRelease({ tag_name: 'v1.9.0' }) === null)
check('객체 아님 거부', parseLatestRelease(null) === null && parseLatestRelease('v1.9.0') === null)

console.log(fail ? `\n${fail}건 실패` : '\n전체 통과')
process.exit(fail ? 1 : 0)
