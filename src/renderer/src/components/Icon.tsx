/** 단색 라인 아이콘 — currentColor 스트로크 (Lucide 기반) */

const PATHS: Record<string, string[]> = {
  open: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 8.07 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  save: ['M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7', 'M7 3v4a1 1 0 0 0 1 1h7'],
  sidebar: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 3v18'],
  prev: ['m15 18-6-6 6-6'],
  next: ['m9 18 6-6-6-6'],
  minus: ['M5 12h14'],
  plus: ['M5 12h14', 'M12 5v14'],
  fitWidth: ['M3 12h18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4'],
  fitPage: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  pageOne: ['M7 3h10v18H7z'],
  pageTwo: ['M3 4h8v16H3z', 'M13 4h8v16h-8z'],
  cover: ['M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z', 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  slide: ['M3 4h18v12H3z', 'M9 20h6', 'M12 16v4'],
  images: ['M9 3h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M3 8v11a1 1 0 0 0 1 1h11', 'M13 7a1 1 0 1 0 0-1 1 1 0 0 0 0 1z', 'm21 13-4-4-7 6'],
  fullscreen: ['M3 8V5a2 2 0 0 1 2-2h3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M21 16v3a2 2 0 0 1-2 2h-3'],
  select: ['m3 3 7.1 17 2.5-7.4 7.4-2.5L3 3z'],
  highlight: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  eraser: ['m7 21-4.3-4.3a1 1 0 0 1 0-1.4L13 5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L13 19', 'M22 21H7', 'm5 11 6 6'],
  image: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'm21 15-5-5L5 21'],
  pageAdd: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 12v6', 'M9 15h6'],
  pdfAdd: ['M15 2H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z', 'M15 2v4h4', 'M5 8v12a2 2 0 0 0 2 2h8'],
  pageDel: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6', 'M10 11v6', 'M14 11v6'],
  download: ['M12 3v12', 'm8 11 4 4 4-4', 'M5 21h14'],
  rotateLeft: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  rotateRight: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  flipH: ['M12 3v18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4'],
  flipV: ['M3 12h18', 'M8 7l4-4 4 4', 'M8 17l4 4 4-4'],
  check: ['M20 6 9 17l-5-5'],
  hand: ['M11 11V5a2 2 0 0 1 4 0v6', 'M15 9V4a2 2 0 0 1 4 0v9', 'M7 13V7a2 2 0 0 1 4 0v4', 'M19 13a8 8 0 0 1-8 8 8 8 0 0 1-5.7-2.3l-3-3a2 2 0 0 1 2.8-2.8L7 13', 'M7 11V5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  rotate: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  ocr: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 8h7', 'M7 12h10', 'M7 16h6'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M3 21v-5h5']
}

interface Props {
  name: keyof typeof PATHS | string
  size?: number
}

export default function Icon({ name, size = 18 }: Props): React.JSX.Element {
  const paths = PATHS[name] ?? []
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
