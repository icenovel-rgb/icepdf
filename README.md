# ICEPDF

아크로벳 리더 스타일의 Windows PDF 뷰어/에디터. 한글(HWPX)·Markdown 변환 내장.

## 기능

- **열기**: PDF·EPUB — 파일 연결(연결 프로그램으로 열기)·드래그드롭·Ctrl+O
- **EPUB 읽기**: 글자 크기(가−/가+)에 맞춰 쪽을 다시 나눔(읽던 위치 유지) · 목차 이동 · 링크 · 텍스트 선택/복사 · 인쇄. 읽기 전용(편집은 PDF 변환 후)
- **EPUB → PDF 변환**: 툴바 "PDF 변환" 또는 Ctrl+S — 현재 글자 크기 그대로 굽고 텍스트(검색·복사)·목차·링크 유지, 폰트 서브셋으로 용량 최소화. 끝나면 새 탭에서 열어 바로 편집 가능
- **찾기**: Ctrl+F — 전체 결과 강조·개수 표시, Enter/F3 다음 · Shift+Enter/Shift+F3 이전, 결과 위치로 스크롤. 선택한 한 줄 텍스트는 검색어로 자동 입력. 대소문자 무시
- **보기**: 연속 스크롤 / 그리드(Ctrl+G) / **슬라이드(한 장씩)** / 한쪽·두쪽(표지 옵션, 표지=오른쪽) · 줌(Ctrl+휠/단축키)·폭맞춤·쪽맞춤 · 너비 조절 썸네일 사이드바
- **숨김/전체화면**: Tab으로 툴바만 숨김 / Ctrl+L로 툴바 숨김+전체화면, Esc로 복귀
- **손도구**: 스페이스바를 누른 채 드래그하면 화면 이동(grab) — 슬라이드/스크롤 어디서나
- **텍스트 선택**: 드래그 선택 → Ctrl+C 복사
- **OCR**: 인식 결과를 페이지 위 **선택 가능한 투명 텍스트 레이어**로 깔아 아크로벳처럼 드래그·복사. 현재 페이지/범위(예: 1-5,8)/전체 선택 가능 (kor+eng)
- **형광펜 / 지우개**: 4색 각진 형광펜, 지우개로 형광펜·이미지 클릭 삭제
- **이미지 삽입/편집**: 원본 비율 유지 배치, 이동·리사이즈(Shift=비율)·자유 회전·좌우/상하 반전 (일러스트식 커서)
- **페이지 편집**: 빈 페이지/다른 PDF 삽입, 페이지 삭제 (Del키, 썸네일/그리드 우클릭)
- **책갈피**: Ctrl+B 추가, 트리 편집, PDF outline 저장 → 아크로벳에서 목차로 보임
- **변환/내보내기**:
  - **Markdown(.md)** — 텍스트+표, 이미지는 `.assets` 폴더로
  - **한글(.hwpx)** — 표는 실제 HWP 표, 이미지는 임베드. 이미지·텍스트를 순서대로 추출하므로 원본 레이아웃(정확한 위치)은 유지되지 않음(내보내기 전 안내 팝업)
  - **이미지(폴더)** — 각 페이지를 PNG로 저장 (레이아웃을 그대로 보려면 이 방식)
- **보기 방식**: 한쪽/두쪽(표지는 오른쪽 단독), 그리드(최대 2배 확대), 슬라이드(한 장씩 — 도구 사용 가능)

## 단축키

| 키 | 동작 |
|---|---|
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | 열기 / 저장(EPUB은 PDF로 변환) / 다른 이름으로 저장 |
| Ctrl+F | 찾기 (Enter·F3 다음 / Shift+Enter·Shift+F3 이전 / Esc 닫기) |
| Ctrl+B | 현재 페이지 책갈피 추가 |
| Ctrl+C | 선택 텍스트 복사 |
| Ctrl+= / Ctrl+- / Ctrl+0 | 확대 / 축소 / 폭 맞춤 |
| Ctrl+G | 그리드 보기 전환 |
| F4 | 사이드바 전환 |
| PageUp / PageDown | 페이지 이동 |

## 개발

```bash
npm install
npm run dev        # 개발 모드
npm run spike      # mupdf 엔진 API 검증 (15항목)
npm run build      # 프로덕션 빌드
npx tsx tests/convert.test.mts # 변환 검증 — 이미지 임베드/표 (#10/#12)
node tests/smoke.mjs           # e2e 스모크 — 기본 편집 (빌드 후)
node tests/smoke2.mjs          # e2e — v0.2 기능 (썸네일/네비/스프레드/지우개/이미지)
node tests/fileopen.mjs        # e2e — 파일 연결 열기 (#1)
node tests/korean-convert.mjs  # 한국어 변환 품질 검증
node spike/make-sample-epub.mjs   # 테스트용 samples/sample.epub 생성 (한글 3장·중첩 목차·링크)
npx tsx tests/doc-kind.test.mts   # PDF/EPUB 판별·글자 크기·리플로우 후 쪽 위치
npx tsx tests/find.test.mts       # 찾기 결과 탐색·순환·상태 문구
npx tsx tests/finder.test.mts     # 찾기 경합 — 검색 도중 Enter·문서 변경·탭 전환·Ctrl+F
npx tsx tests/store-tabs.test.mts # 비동기 결과가 시작한 문서 탭에만 반영되는지
npx tsx tests/epub-engine.test.mts # EPUB 열기·목차·구간 검색·EPUB→PDF 변환(실제 mupdf)
node tests/smoke-find.mjs      # e2e — Ctrl+F 실제 키 입력 (빌드 후)
node tests/smoke-epub.mjs      # e2e — EPUB 읽기·글자 크기·목차·PDF 변환·Markdown 내보내기 (빌드 후)
npm run dist       # NSIS 설치파일 생성 → release/ICEPDF-Setup-*.exe
node tests/packaged-smoke.mjs  # 패키징된 앱 검증 (이미지 포함 HWPX)
ICEPDF_EXE=release/win-unpacked/ICEPDF.exe node tests/smoke-epub.mjs  # 패키징 앱으로 EPUB·변환 검증 (smoke-find도 동일)
```

## 알려진 한계

- **HWPX 내보내기**: 이미지·텍스트를 순서대로 추출하므로 원본 레이아웃은 유지되지 않음(내보내기 전 안내). 정확한 레이아웃이 필요하면 "이미지(폴더)" 사용.
- **이미지 재선택**: 회전/반전은 이번 세션에 삽입한 이미지에만 가능(저장·재열기 후에는 이동/리사이즈만).
- **EPUB**: 읽기 전용(형광펜·텍스트·쪽 편집은 PDF로 변환한 뒤). DRM(암호화)이 걸린 EPUB은 지원하지 않음(복호화 불가). 글자 크기 변경 시 읽던 위치는 쪽 비율로 근사 유지. PDF 변환은 변환 시점의 글자 크기로 쪽이 고정됨.
- **OCR**: 이미지 디자인·해상도에 따라 완벽히 인식되지 않을 수 있음(실행 전 안내). 첫 실행 시 언어데이터(kor+eng) 다운로드(인터넷 필요), 이후 캐시되어 오프라인 동작. 코어는 설치파일 포함.

## 아키텍처

```
Electron
├─ main process
│  ├─ engine worker (worker_thread) ── mupdf.js(WASM): 렌더·선택·검색·주석·페이지편집·책갈피·저장, EPUB 리플로우·PDF 변환
│  └─ convert worker (worker_thread) ─ kordoc: PDF→Markdown→HWPX
└─ renderer (React + zustand) ──────── 뷰어 UI, 좌표는 전부 fitz 공간(좌상단 원점)×zoom
```

## 후원

이 프로그램이 유용했다면 ☕ [Buy Me a Coffee](https://buymeacoffee.com/icenovel)로 응원해 주세요. (앱 메뉴 `후원` 또는 우측 상단 ☕)

## 라이선스

ICEPDF는 **GNU AGPL-3.0**으로 배포됩니다. 핵심 엔진 **MuPDF(mupdf.js)가 AGPL-3.0**이라 전체가 AGPL을 따릅니다.
배포(설치파일 공유 포함) 시 해당 버전의 **전체 소스를 AGPL-3.0으로 제공**해야 합니다. 비공개/상업 이용은 Artifex의 MuPDF 상용 라이선스가 필요합니다.

의존성 라이선스 전체 목록은 [`THIRD_PARTY-NOTICES.md`](THIRD_PARTY-NOTICES.md), 라이선스 본문은 [`LICENSE`](LICENSE) 참고.
(AGPL 전문은 `curl -L https://www.gnu.org/licenses/agpl-3.0.txt -o COPYING`로 받아 함께 배포)
