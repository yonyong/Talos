/**
 * 控制台偏好设置 + 当前用户个人信息。
 *
 * 鉴权已接入服务端（邮箱 + 邮件授权码，见 auth.ts / Login.tsx），二者仍持久化在 localStorage：
 *   - talos.settings  偏好（主题色 / 界面密度 / 登录后默认页）
 *   - talos.profile   个人信息（姓名 / 工号 / 角色 / 邮箱 / 手机号），登录成功后由服务端回填
 * 登录凭据单独存 talos.token / talos.user，改坏 profile 不会影响登录。
 */
import type { PageKey } from './types'
import { roleLabel } from './constants'

/* ============ 偏好设置 ============ */

export const ACCENTS = {
  indigo: { label: '靛蓝', accent: '#4f46e5', accent2: '#6366f1', ink: '#4338ca', soft: 'rgba(79, 70, 229, 0.07)' },
  blue: { label: '湛蓝', accent: '#0e7490', accent2: '#0891b2', ink: '#155e75', soft: 'rgba(14, 116, 144, 0.08)' },
  green: { label: '松绿', accent: '#15803d', accent2: '#16a34a', ink: '#166534', soft: 'rgba(21, 128, 61, 0.08)' },
  amber: { label: '琥珀', accent: '#b45309', accent2: '#d97706', ink: '#92400e', soft: 'rgba(180, 83, 9, 0.08)' },
  slate: { label: '墨黑', accent: '#18181b', accent2: '#3f3f46', ink: '#27272a', soft: 'rgba(24, 24, 27, 0.06)' },
} as const

export type AccentKey = keyof typeof ACCENTS

/** 暗色主题下的 accent 变体：亮色版在深底上会偏暗，暗色版整体提亮一档 */
export const ACCENTS_DARK = {
  indigo: { accent: '#818cf8', accent2: '#a5b4fc', ink: '#c7d2fe', soft: 'rgba(129, 140, 248, 0.16)' },
  blue: { accent: '#22d3ee', accent2: '#67e8f9', ink: '#a5f3fc', soft: 'rgba(34, 211, 238, 0.16)' },
  green: { accent: '#4ade80', accent2: '#86efac', ink: '#bbf7d0', soft: 'rgba(74, 222, 128, 0.16)' },
  amber: { accent: '#fbbf24', accent2: '#fcd34d', ink: '#fde68a', soft: 'rgba(251, 191, 36, 0.16)' },
  slate: { accent: '#e4e4e7', accent2: '#a1a1aa', ink: '#fafafa', soft: 'rgba(228, 228, 231, 0.14)' },
} as const

export type ThemeMode = 'light' | 'dark' | 'system'
export type ScaleKey = 'sm' | 'md' | 'lg'

/** 桌面通知偏好：开关 + 订阅的事件 */
export interface NotifyPrefs {
  enabled: boolean
  /** 作业完成（实例终态 done） */
  jobDone: boolean
  /** 作业失败 / 被阻断 */
  jobFailed: boolean
  /** 有新 Issue 录入待处理 */
  newIssue: boolean
}

export interface Settings {
  accent: AccentKey
  density: 'comfort' | 'compact'
  /** 登录后默认进入的页面 */
  homePage: PageKey
  /** 明暗主题；system = 跟随操作系统 */
  theme: ThemeMode
  /** 界面缩放（小/标准/大） */
  scale: ScaleKey
  /** 侧栏默认折叠 */
  sideCollapsed: boolean
  /** 桌面通知与提醒 */
  notify: NotifyPrefs
}

const DEFAULTS: Settings = {
  accent: 'indigo',
  density: 'comfort',
  homePage: 'dashboard',
  theme: 'light',
  scale: 'md',
  sideCollapsed: false,
  notify: { enabled: false, jobDone: true, jobFailed: true, newIssue: false },
}

const KEY = 'talos.settings'

/** 界面缩放对应的 zoom 值（CSS px 布局下用 zoom 做整体等比缩放） */
export const SCALE_ZOOM: Record<ScaleKey, number> = { sm: 0.94, md: 1, lg: 1.08 }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS, notify: { ...DEFAULTS.notify } }
    const s = JSON.parse(raw) as Partial<Settings>
    return {
      accent: s.accent && s.accent in ACCENTS ? s.accent : DEFAULTS.accent,
      density: s.density === 'compact' ? 'compact' : 'comfort',
      homePage: (['dashboard', 'issues', 'monitor'] as PageKey[]).includes(s.homePage as PageKey)
        ? (s.homePage as PageKey)
        : DEFAULTS.homePage,
      theme: s.theme === 'dark' || s.theme === 'system' ? s.theme : DEFAULTS.theme,
      scale: s.scale === 'sm' || s.scale === 'lg' ? s.scale : DEFAULTS.scale,
      sideCollapsed: s.sideCollapsed === true,
      notify: { ...DEFAULTS.notify, ...(s.notify ?? {}) },
    }
  } catch {
    return { ...DEFAULTS, notify: { ...DEFAULTS.notify } }
  }
}

/** 解析实际生效的主题：system 回落到系统偏好 */
export function resolveTheme(t: ThemeMode): 'light' | 'dark' {
  if (t !== 'system') return t
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 偏好变更事件名：任何地方 saveSettings 后广播，订阅方（Console）据此刷新自己的状态 */
export const SETTINGS_EVENT = 'talos:settings'

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s))
  applySettings(s)
  // 通知订阅者（否则设置面板里改的项在其它组件的 state 里还是旧值）
  window.dispatchEvent(new CustomEvent<Settings>(SETTINGS_EVENT, { detail: s }))
}

/**
 * 把偏好写进 CSS 变量 / 根节点属性，改完即时生效：
 * 主题色（暗色用提亮版）· 明暗主题 · 界面缩放 · 密度 · 侧栏折叠。
 */
export function applySettings(s: Settings) {
  const theme = resolveTheme(s.theme)
  const a = theme === 'dark' ? ACCENTS_DARK[s.accent] : ACCENTS[s.accent]
  const root = document.documentElement.style
  root.setProperty('--accent', a.accent)
  root.setProperty('--accent-2', a.accent2)
  root.setProperty('--accent-ink', a.ink)
  root.setProperty('--accent-soft', a.soft)
  document.documentElement.dataset.theme = theme
  root.zoom = String(SCALE_ZOOM[s.scale])
  document.body.classList.toggle('compact', s.density === 'compact')
  document.body.classList.toggle('side-collapsed', s.sideCollapsed)
}

/* ============ 个人信息 ============ */

export interface Profile {
  name: string
  no: string
  role: string
  email: string
  phone: string
}

/**
 * 个人信息。登录（邮箱 + 授权码）成功后由服务端返回的真实用户信息覆盖 ——
 * 这里只作为「尚未登录」时的空壳，因此不放任何真实姓名/工号/邮箱（部署信息不该写进代码）。
 */
export const DEFAULT_PROFILE: Profile = {
  name: '',
  no: '',
  role: '',
  email: '',
  phone: '',
}

const PROFILE_KEY = 'talos.profile'

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) } : { ...DEFAULT_PROFILE }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

export function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

/**
 * 用登录返回的真实身份覆盖个人信息。
 * 控制台顶栏、个人设置（agent/git 配置按工号定位）、Issue 默认提出人都读 profile，
 * 因此登录成功与启动校验通过时都要同步一次。
 */
export function applyUserProfile(u: { name?: string; empNo?: string; role?: string; email?: string }) {
  const prev = loadProfile()
  saveProfile({
    ...prev,
    name: u.name || prev.name,
    no: u.empNo || prev.no,
    role: (u.role && roleLabel[u.role]) || u.role || prev.role,
    email: u.email || prev.email,
  })
}

/** 头像字母：取姓名前两个字符的大写 */
export function avatarText(name: string): string {
  return (name || '?').replace(/\s/g, '').slice(0, 2).toUpperCase()
}
