# 제3자 오픈소스 고지 (Third-Party Notices)

ICEPDF는 다음 오픈소스 구성요소를 사용합니다. 각 구성요소는 해당 라이선스를 따릅니다.

| 구성요소 | 용도 | 라이선스 |
|---|---|---|
| [MuPDF / mupdf.js](https://github.com/ArtifexSoftware/mupdf.js) | PDF 렌더·텍스트 선택·주석·페이지 편집·저장 | **AGPL-3.0** (Artifex) |
| [kordoc](https://github.com/chrisryugj/kordoc) | 한국 문서(HWP/HWPX/PDF) 파싱 및 Markdown↔HWPX 변환 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | kordoc의 PDF 텍스트 추출 백엔드 | Apache-2.0 |
| [tesseract.js](https://github.com/naptha/tesseract.js) / tesseract.js-core | OCR 글자 인식 | Apache-2.0 |
| [Electron](https://github.com/electron/electron) | 데스크톱 런타임 | MIT |
| [React](https://github.com/facebook/react) / react-dom | UI | MIT |
| [zustand](https://github.com/pmndrs/zustand) | 상태 관리 | MIT |
| [JSZip](https://github.com/Stuk/jszip) | HWPX(zip) 처리 | MIT/GPL 듀얼 |

## 중요 — 라이선스 전염성

핵심 엔진 **MuPDF(mupdf.js)가 AGPL-3.0**이므로, 이를 포함·링크한 ICEPDF 전체가 **AGPL-3.0**으로 배포됩니다.
ICEPDF를 배포(설치파일 공유 포함)하는 경우 해당 버전의 **전체 소스 코드를 AGPL-3.0으로 제공**해야 합니다.

비공개 또는 상업적 이용을 원하는 경우, MuPDF는 [Artifex](https://artifex.com/licensing/)의 상용 라이선스를 별도로 취득해야 합니다.

OCR 언어 데이터(kor/eng, tessdata)는 최초 실행 시 내려받아 캐시되며 설치파일에 포함되지 않습니다(Apache-2.0).

## 원저작물

- 애플리케이션 코드 전체(뷰어 UI, 엔진/변환/OCR 연동, HWPX 임베드 등): © icenovel, AGPL-3.0
- 아이콘(`favicon.png` 기반) 및 후원 QR: © icenovel
