/**
 * 문장 카드 배경 프리셋 — 이미지 20장은 gpt-image(codex)로 만든 글자 없는 배경(1024×1536),
 * 나머지는 단색. ink=어울리는 글자색, shade=글자가 잘 보이게 덮는 막.
 */
import paperCream from '../assets/cards/paper-cream.jpg'
import linenGray from '../assets/cards/linen-gray.jpg'
import watercolorSky from '../assets/cards/watercolor-sky.jpg'
import forestMist from '../assets/cards/forest-mist.jpg'
import nightSky from '../assets/cards/night-sky.jpg'
import windowLight from '../assets/cards/window-light.jpg'
import seaDusk from '../assets/cards/sea-dusk.jpg'
import driedFlowers from '../assets/cards/dried-flowers.jpg'
import cherryBlossom from '../assets/cards/cherry-blossom.jpg'
import inkMountains from '../assets/cards/ink-mountains.jpg'
import marble from '../assets/cards/marble.jpg'
import pastelGradient from '../assets/cards/pastel-gradient.jpg'
import autumnLeaves from '../assets/cards/autumn-leaves.jpg'
import sandDunes from '../assets/cards/sand-dunes.jpg'
import leafShadow from '../assets/cards/leaf-shadow.jpg'
import lavenderField from '../assets/cards/lavender-field.jpg'
import rainyWindow from '../assets/cards/rainy-window.jpg'
import snowyForest from '../assets/cards/snowy-forest.jpg'
import botanicalDark from '../assets/cards/botanical-dark.jpg'
import tealWater from '../assets/cards/teal-water.jpg'

export interface CardBackground {
  id: string
  label: string
  /** 이미지 배경이면 URL, 단색이면 undefined */
  src?: string
  /** 단색 배경(이미지 로딩 전 바탕색 겸) */
  color: string
  ink: string
  shade: number
}

export const CARD_BACKGROUNDS: CardBackground[] = [
  { id: 'paper-cream', label: '크림 종이', src: paperCream, color: '#efe4cf', ink: '#3d3226', shade: 0 },
  { id: 'window-light', label: '창가 햇살', src: windowLight, color: '#eadbc0', ink: '#4a3b2c', shade: 0 },
  { id: 'dried-flowers', label: '말린 꽃', src: driedFlowers, color: '#e6d4b8', ink: '#4b3a2a', shade: 0 },
  { id: 'watercolor-sky', label: '수채화', src: watercolorSky, color: '#f3f3f6', ink: '#39404d', shade: 0 },
  { id: 'cherry-blossom', label: '벚꽃', src: cherryBlossom, color: '#f8e8ec', ink: '#5a3a44', shade: 0 },
  { id: 'ink-mountains', label: '수묵 산수', src: inkMountains, color: '#f1e6d2', ink: '#2f2b27', shade: 0 },
  { id: 'marble', label: '대리석', src: marble, color: '#f2f2f0', ink: '#2d2d2d', shade: 0 },
  { id: 'pastel-gradient', label: '파스텔', src: pastelGradient, color: '#ead9ee', ink: '#3d3550', shade: 0 },
  { id: 'leaf-shadow', label: '잎 그림자', src: leafShadow, color: '#efe0c6', ink: '#4a3b2c', shade: 0 },
  { id: 'snowy-forest', label: '눈 내린 숲', src: snowyForest, color: '#e4e9ee', ink: '#2e3a46', shade: 0 },
  { id: 'sand-dunes', label: '모래 언덕', src: sandDunes, color: '#e9a873', ink: '#3f2616', shade: 0 },
  { id: 'linen-gray', label: '리넨', src: linenGray, color: '#c9c9c9', ink: '#262626', shade: 0.12 },
  { id: 'teal-water', label: '청록 바다', src: tealWater, color: '#1fb3a6', ink: '#ffffff', shade: 0.22 },
  { id: 'lavender-field', label: '라벤더', src: lavenderField, color: '#9a7cc0', ink: '#fffaf4', shade: 0.2 },
  { id: 'forest-mist', label: '안개 숲', src: forestMist, color: '#25323a', ink: '#f2f0ea', shade: 0.25 },
  { id: 'autumn-leaves', label: '단풍', src: autumnLeaves, color: '#2e1b12', ink: '#f6ead8', shade: 0.1 },
  { id: 'night-sky', label: '밤하늘', src: nightSky, color: '#0c1430', ink: '#f1f0f7', shade: 0.08 },
  { id: 'rainy-window', label: '비 오는 창', src: rainyWindow, color: '#0d1a2e', ink: '#eef2f8', shade: 0 },
  { id: 'sea-dusk', label: '해 질 녘 바다', src: seaDusk, color: '#3b2340', ink: '#fbf3ec', shade: 0.18 },
  { id: 'botanical-dark', label: '어둠 속 꽃', src: botanicalDark, color: '#0e0f0b', ink: '#efe8da', shade: 0 },
  { id: 'solid-white', label: '흰색', color: '#ffffff', ink: '#222222', shade: 0 },
  { id: 'solid-ivory', label: '아이보리', color: '#f6f1e7', ink: '#3b3229', shade: 0 },
  { id: 'solid-charcoal', label: '차콜', color: '#2b2b2e', ink: '#f2f2f2', shade: 0 },
  { id: 'solid-navy', label: '네이비', color: '#1f2a44', ink: '#f3efe6', shade: 0 }
]

/** 카드 글꼴 후보 — 설치된 것만 보여준다(맑은 고딕·바탕은 윈도우 기본) */
export const CARD_FONT_CANDIDATES = [
  { label: '바탕', value: 'Batang' },
  { label: '맑은 고딕', value: 'Malgun Gothic' },
  { label: '궁서', value: 'Gungsuh' },
  { label: '나눔명조', value: 'NanumMyeongjo' },
  { label: '나눔고딕', value: 'NanumGothic' },
  { label: '나눔손글씨 펜', value: 'Nanum Pen Script' },
  { label: '나눔손글씨 붓', value: 'Nanum Brush Script' },
  { label: '마루 부리', value: 'MaruBuri' },
  { label: '리디바탕', value: 'RIDIBatang' },
  { label: '본명조 (Noto Serif KR)', value: 'Noto Serif KR' },
  { label: '본고딕 (Noto Sans KR)', value: 'Noto Sans KR' },
  { label: 'KoPub 바탕', value: 'KoPubWorldBatang' }
]

const ALWAYS = new Set(['Batang', 'Malgun Gothic'])

/** 폰트가 설치됐는지 — 대체 글꼴과 너비가 달라지는지로 판단 */
export function availableCardFonts(): { label: string; value: string }[] {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return CARD_FONT_CANDIDATES.filter((f) => ALWAYS.has(f.value))
  const sample = '가나다 책 속의 한 문장 abcXYZ 123'
  const width = (font: string): number => {
    ctx.font = `40px ${font}`
    return ctx.measureText(sample).width
  }
  const fallbacks = ['monospace', 'serif', 'sans-serif'].map((f) => [f, width(f)] as const)
  return CARD_FONT_CANDIDATES.filter(
    (f) => ALWAYS.has(f.value) || fallbacks.some(([fb, w]) => width(`"${f.value}", ${fb}`) !== w)
  )
}
