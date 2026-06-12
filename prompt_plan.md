# ICEPDF 구현 계획

> 확정일: 2026-06-12 · 상태: **v0.1 전체 완료 → v0.2 사용자 피드백 12건 완료**
> v0.2 검증: convert 9/9 · smoke 13/13 · smoke2 9/9 · fileopen 1/1 · 패키징(이미지 HWPX) 3/3
> 산출물: `release/ICEPDF-Setup-0.2.0.exe` (NSIS 원클릭, .pdf 연결 등록)
>
> v0.2 처리: #1 연결열기/드래그드롭 · #2 썸네일 가상화 · #3 이전버튼 · #4 사이드바 리사이즈 ·
> #5 그리드 Ctrl+휠 · #6 쪽맞춤 · #7 지우개 · #8 이미지 비율유지 · #9 이미지 회전/반전/리사이즈 ·
> #10 HWPX 이미지 임베드 · #11 한쪽/두쪽/표지 · #12 HTML표 리터럴 제거
>
> v0.3 처리(UI/UX 폴리시): A 형광펜 각짐(Square) · B 지우개 커서 · C 이미지 일러스트식 커서+자유회전 ·
> D 스페이스바 손도구 · E 이미지 도구툴 재디자인 · F 단색 라인 아이콘 · G favicon→앱아이콘 · H 레이아웃 보존 내보내기
> v0.3 검증: convert 12/12 · smoke 13/13 · smoke2 10/10 · 산출물 ICEPDF-Setup-0.3.0.exe
>
> v0.4 처리: I 폴더 이미지 내보내기(전면이미지 레이아웃 폐기) · II 한글 레이아웃 유지(글상자+이미지 절대배치) ·
> III OCR(tesseract.js kor+eng) · IV 스페이스 hand툴 · V Del 삭제 · VI 표지 오른쪽 · VII 슬라이드 보기 · VIII Ctrl+L 전체화면
> v0.4 검증: convert 16/16 · smoke 13/13 · smoke2 10/10 · smoke3 6/6 · fileopen 1/1 · 산출물 ICEPDF-Setup-0.4.0.exe
>
> v0.5/v0.5.1 처리: 손툴 스페이스 버그·커서, Tab/Ctrl+L 분리(전체화면 메뉴바 유지), 슬라이드 도구 동작, OCR 텍스트레이어+범위,
> 레이아웃 HWPX 한글 닫힘 수정(글상자 제거→kordoc 문단 재사용). 검증: convert 17/17 · smoke3 7/7 · 패키징 4/4
> ⚠ 레이아웃 HWPX 한글 실개봉 미검증(환경 없음) — 사용자 확인 필요

## 검증 증거 (2026-06-12)

- `npm run spike` — mupdf API 15/15 통과 (렌더·선택·형광펜·페이지편집·책갈피·이미지·저장·재열기·CJK)
- `node tests/smoke.mjs` — 빌드된 앱 e2e 13/13 통과 (스크린샷: spike/output/0*.png)
- `node tests/korean-convert.mjs` — 실제 한국어 PDF(printToPDF) → MD/HWPX 4/4 통과 (헤딩·표·한글 보존)
- 주의: ToUnicode CMap 없는 PDF는 kordoc(pdfjs) 텍스트 추출 불가 — 뷰어(mupdf)는 정상

## 요구사항

아크로벳 리더 유사 PDF 데스크톱 앱 (Windows):

1. 텍스트 선택 (드래그 → 복사)
2. 페이지 삽입/삭제 (빈 페이지, 다른 PDF에서 가져오기)
3. 책갈피(Ctrl+B)로 목차 만들기 — PDF outline으로 저장, 아크로벳 호환
4. PPT처럼 여러 페이지 그리드 미리보기 + 썸네일 사이드바
5. kordoc(https://github.com/chrisryugj/kordoc.git) 활용 PDF→HWPX(한글)/Markdown 변환
6. 형광펜(텍스트 앵커 하이라이트), 이미지 삽입 → PDF에 저장
7. 단일 설치파일(setup.exe) — 의존성 없이 설치

## 아키텍처 결정

**Electron + TypeScript + React (electron-vite) / mupdf.js / kordoc / electron-builder(NSIS)**

- kordoc은 Node.js 라이브러리(npm v3.0.1, MIT) → Electron이면 in-process 함수 호출로 통합. Python 등 다른 스택이면 Node 런타임 사이드카가 필요해 "의존성 없는 단일 설치파일" 요구와 충돌.
- kordoc이 PDF→Markdown 파서(`parsePdf`)와 Markdown→HWPX 생성기(`markdownToHwpx`)를 모두 내장 → 변환 파이프라인: PDF → kordoc parse → markdown → markdownToHwpx → .hwpx
- mupdf.js(npm `mupdf` v1.27.0, WASM, AGPL)가 문서 엔진: 렌더링(toPixmap), 텍스트 선택(StructuredText.highlight/copy), 형광펜(createAnnotation "Highlight" + setQuadPoints), 페이지 삽입/삭제(insertPage/graftPage/deletePage), 책갈피(outlineIterator), 이미지 삽입(PDFPage.insertImage), 저장(saveToBuffer)
- mupdf는 main process의 worker_thread에서 실행 (렌더링이 메인 프로세스를 막지 않도록), IPC로 renderer와 통신
- pdfjs-dist는 kordoc의 peer dep으로만 사용, kordoc devDeps 기준 4.10.38 핀

## 프로젝트 구조

```
ICEPDF/
├── package.json / electron.vite.config.ts / tsconfig*.json
├── src/
│   ├── main/
│   │   ├── index.ts            # 창 생성, 메뉴, 단축키
│   │   ├── ipc.ts              # IPC 핸들러 (파일 다이얼로그, 엔진 프록시, 변환)
│   │   ├── engine/
│   │   │   ├── proxy.ts        # worker RPC 클라이언트
│   │   │   └── worker.ts       # mupdf 엔진 (worker_thread 진입점)
│   │   └── convert/kordoc.ts   # PDF→MD/HWPX 변환
│   ├── preload/index.ts        # contextBridge API
│   └── renderer/               # React UI (한국어)
│       ├── App.tsx
│       ├── components/ Toolbar, Viewer(연속스크롤), PageCanvas, SelectionLayer,
│       │               ThumbnailPanel, GridView, BookmarkPanel, StatusBar, ExportDialog
│       ├── hooks/ state/
├── build/                      # 아이콘, NSIS 설정
└── samples/                    # 테스트 PDF
```

## 단계별 계획

| # | 단계 | 완료 기준 (증거 기반) |
|---|---|---|
| 1 | 스캐폴드 + 엔진 스파이크: Node 스크립트로 mupdf 핵심 API 검증 (렌더, structuredText.highlight, 형광펜 annot, insertPage/graftPage/deletePage, outlineIterator 쓰기, insertImage, saveToBuffer) | spike 스크립트 전부 통과 출력 |
| 2 | 엔진 서비스: worker_thread RPC + IPC + preload 브리지 | open→pageCount→renderPage PNG 왕복 |
| 3 | 뷰어: 연속 스크롤(가상화), 줌(Ctrl+휠/버튼), 페이지 이동 | 샘플 PDF 표시 스크린샷 |
| 4 | 썸네일 사이드바 + PPT식 그리드 뷰(크기 슬라이더, 더블클릭 이동) | 전환 동작 |
| 5 | 텍스트 선택: 드래그→quads 하이라이트 표시→Ctrl+C 복사 | 복사된 텍스트 일치 |
| 6 | 페이지 편집: 삭제, 빈 페이지 삽입, 다른 PDF에서 삽입 (썸네일 컨텍스트 메뉴 + 메뉴바) | 저장 후 재열기로 페이지 수 검증 |
| 7 | 책갈피: 패널 트리, Ctrl+B 현재 페이지 추가, 이름변경/삭제, PDF outline 저장 | 저장 파일의 outline을 spike 스크립트로 검증 |
| 8 | 주석: 형광펜(색 4종, 텍스트 선택 기반), 이미지 삽입(파일 선택→클릭 배치→크기 조절), Ctrl+S 저장 | 저장 파일 재열기 시 주석 유지 |
| 9 | 변환: 내보내기 메뉴 → Markdown(.md)/HWPX(.hwpx), kordoc 호출, 진행 표시 | 생성된 .hwpx 구조 검증(zip 엔트리), .md 내용 확인 |
| 10 | 패키징: electron-builder NSIS oneClick 설치파일, 앱 아이콘, 빌드 검증 | setup.exe 생성 + 설치 후 실행 확인 |

## 리스크

- HIGH: Naver MYBOX 동기화 폴더에서 node_modules 동기화 충돌 → 동기화 제외 권장, 빌드 오류 시 산출물 로컬 이동
- MEDIUM: mupdf.js API의 JS 노출 공백(특히 outlineIterator) → 1단계 스파이크에서 먼저 검증, 폴백 pdf-lib 저수준
- MEDIUM: PDF→HWPX 충실도는 텍스트/표/헤딩 구조 수준 (레이아웃 픽셀 재현 아님)
- LOW: mupdf.js AGPL — 개인 사용 OK, 공개 배포 시 소스 공개 의무. kordoc MIT, PDF.js Apache-2

## 키보드 단축키

Ctrl+O 열기 · Ctrl+S 저장 · Ctrl+Shift+S 다른 이름으로 · Ctrl+B 책갈피 추가 · Ctrl+C 선택 복사 · Ctrl +/- 줌 · Ctrl+0 폭맞춤 · PgUp/PgDn 페이지 이동
