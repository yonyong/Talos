import React from 'react'

const P: Record<string, React.ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  x: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  issue: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></>,
  git: <><circle cx="7" cy="6" r="2.6" /><circle cx="7" cy="18" r="2.6" /><circle cx="17" cy="12" r="2.6" /><path d="M7 8.6v6.8" /><path d="M9.6 6h3.2a2.6 2.6 0 012.6 2.6v.8" /></>,
  branch: <><path d="M6 4v12" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M18 9v3a4 4 0 01-4 4H8" /></>,
  doc: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></>,
  code: <><path d="M9 18l-5-6 5-6" /><path d="M15 6l5 6-5 6" /></>,
  test: <><path d="M9 3h6" /><path d="M10 3v5.5L5.6 17A2.5 2.5 0 007.8 21h8.4a2.5 2.5 0 002.2-3.5L14 8.5V3" /><path d="M8.5 14h7" /></>,
  review: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.8" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.8" /></>,
  spark: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" /></>,
  bolt: <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />,
  flow: <><rect x="3" y="4" width="7" height="5" rx="1.5" /><rect x="14" y="15" width="7" height="5" rx="1.5" /><path d="M6.5 9v5.5a2 2 0 002 2H14" /></>,
  agent: <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M9 19v2" /><path d="M15 19v2" /><circle cx="9" cy="13" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.3" fill="currentColor" stroke="none" /><path d="M12 7V4" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="10" y="10" width="4" height="4" rx="1" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
  client: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  users: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 5.2a3.4 3.4 0 010 6.6" /><path d="M18 20a6 6 0 00-2.2-4.6" /></>,
  shield: <><path d="M12 3l7.5 3v6c0 4.5-3.1 7.9-7.5 9.5C7.6 19.9 4.5 16.5 4.5 12V6z" /><path d="M9 12l2 2 4-4" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2.4" /><path d="M8.5 10V7.5a3.5 3.5 0 017 0V10" /></>,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9" /><path d="M18 12v3" /><path d="M15.5 12v2.5" /></>,
  download: <><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M4.5 20h15" /></>,
  upload: <><path d="M12 16V5" /><path d="M7.5 9.5L12 5l4.5 4.5" /><path d="M4.5 20h15" /></>,
  refresh: <><path d="M20 11a8 8 0 10-2.6 5.9" /><path d="M20 5v6h-6" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9l3 3-3 3" /><path d="M13 15h4" /></>,
  cloud: <path d="M7 18h10.5a3.5 3.5 0 00.3-7A5.5 5.5 0 007.4 8.2A4.4 4.4 0 007 18z" />,
  db: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  network: <><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="M12 7.4v4.2M10.6 13L6.6 16M13.4 13l4 3" /></>,
  bell: <><path d="M18 15V10a6 6 0 10-12 0v5l-2 3h16z" /><path d="M10 21h4" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h8" /></>,
  edit: <><path d="M4 20h4L19 9a2.5 2.5 0 10-3.5-3.5L4.5 16.5z" /><path d="M14 6.5L17.5 10" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  warn: <><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.2v.6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8v.6" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 19V8a1.5 1.5 0 011.5-1.5h5" /></>,
  sparkle: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /></>,
  dashboard: <><rect x="3" y="4" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="4" width="7.5" height="4.5" rx="1.6" /><rect x="3" y="14" width="7.5" height="6" rx="1.6" /><rect x="13.5" y="11" width="7.5" height="9" rx="1.6" /></>,
  logout: <><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h9" /></>,
  file: <><path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9z" /><path d="M13 3v6h6" /></>,
  send: <><path d="M4 12l16-8-6 16-3-6z" /></>,
}

export type IconName = keyof typeof P

export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  const d = P[name] ?? P.info
  return (
    <span className={`ic ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {d}
      </svg>
    </span>
  )
}

/** Talos 品牌标记 — Cycle T（弧形 T + 轨道环 + 交付节点） */
export function Mark({ size = 26 }: { size?: number }) {
  const uid = React.useId().replace(/:/g, '')
  const gid = `talos-mark-${uid}`
  return (
    <span className="mark" style={{ width: size, height: size, display: 'inline-block' }}>
      <svg viewBox="0 0 32 32" fill="none" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2e2a7a" />
            <stop offset=".4" stopColor="#4f46e5" />
            <stop offset="1" stopColor="#8b9cf7" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${gid})`} />
        <circle cx="16" cy="16.2" r="8.6" fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="1.25" />
        <path d="M8.6 12.4c2.4-2.05 4.9-3.05 7.4-3.05s5 1 7.4 3.05"
          stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M16 10v10.2" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M16 21.6l1.85 1.85L16 25.3l-1.85-1.85z" fill="#fff" stroke="none" />
      </svg>
    </span>
  )
}
