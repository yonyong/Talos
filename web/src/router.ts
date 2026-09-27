import { useEffect, useState } from 'react'
import type { PageFocus, PageKey } from './types'

/**
 * 极简 hash 路由（零依赖）。
 *
 * 为什么用 hash 而不是 history：
 * 前端产物是嵌进 server jar 的静态资源，服务端没有 SPA fallback —— 直接访问
 * /console/monitor 会 404。hash 全部由浏览器处理，刷新、收藏、前进后退都无需服务端配合。
 *
 * 形态：
 *   #/                 品牌官网
 *   #/download         客户端下载页
 *   #/login            登录
 *   #/app/<page>       控制台页面（page 省略时回落 dashboard）
 *   #/app/monitor?issueCode=BUG-1   跨页下钻参数
 */
export type Route =
  | { view: 'landing' }
  | { view: 'download' }
  | { view: 'login' }
  | { view: 'app'; page: PageKey; focus?: PageFocus }

/** 控制台所有合法页面 key，与 Console 的 NAV 保持一致 */
export const PAGE_KEYS: PageKey[] = [
  'dashboard', 'issues', 'admission', 'workflow', 'monitor',
  'clients', 'guide', 'agents', 'logs', 'docs', 'kb',
  'prompts', 'models',
  'biz', 'repos',
  'users', 'roles',
]

const FOCUS_TEXT: (keyof PageFocus)[] = ['issueCode', 'clientId', 'status', 'q']
const FOCUS_FLAG: (keyof PageFocus)[] = ['offline', 'outdated']

export function parseHash(hash: string): Route {
  const raw = (hash || '').replace(/^#/, '')
  const [path, query = ''] = raw.split('?')
  const segs = path.split('/').filter(Boolean)
  const q = new URLSearchParams(query)

  const focusOf = (): PageFocus | undefined => {
    const f: PageFocus = { at: Date.now() }
    let hit = false
    for (const k of FOCUS_TEXT) {
      const v = q.get(String(k))
      if (v) { (f as unknown as Record<string, unknown>)[String(k)] = v; hit = true }
    }
    for (const k of FOCUS_FLAG) {
      if (q.get(String(k)) === '1') { (f as unknown as Record<string, unknown>)[String(k)] = true; hit = true }
    }
    return hit ? f : undefined
  }

  if (segs[0] === 'download') return { view: 'download' }
  if (segs[0] === 'login') return { view: 'login' }
  if (segs[0] === 'app') {
    const candidate = segs[1] as PageKey | undefined
    const page = candidate && PAGE_KEYS.includes(candidate) ? candidate : 'dashboard'
    return { view: 'app', page, focus: focusOf() }
  }
  return { view: 'landing' }
}

export function routeToHash(r: Route): string {
  switch (r.view) {
    case 'download': return '#/download'
    case 'login': return '#/login'
    case 'app': {
      const q = new URLSearchParams()
      const f = r.focus
      if (f) {
        for (const k of FOCUS_TEXT) {
          const v = f[k]
          if (v !== undefined && v !== null && v !== '') q.set(String(k), String(v))
        }
        for (const k of FOCUS_FLAG) if (f[k]) q.set(String(k), '1')
      }
      const s = q.toString()
      return `#/app/${r.page}${s ? `?${s}` : ''}`
    }
    default: return '#/'
  }
}

type Listener = (r: Route) => void

let listeners: Listener[] = []

function emit() {
  const r = parseHash(window.location.hash)
  listeners.forEach((l) => l(r))
}

/**
 * 跳转。
 * @param replace 用 replace 而不是 push —— 登录跳转、退出登录这类不该留在历史里
 */
export function navigate(r: Route, replace = false) {
  const hash = routeToHash(r)
  if (window.location.hash !== hash) {
    if (replace) window.location.replace(hash)
    else window.location.hash = hash
  }
  // location.replace 的 hashchange 时机不保证，这里同步通知一次，避免界面等下一帧
  emit()
}

/** 订阅当前路由；刷新与前进/后退都会同步 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const l: Listener = (r) => setRoute(r)
    listeners.push(l)
    const onHash = () => emit()
    window.addEventListener('hashchange', onHash)
    return () => {
      listeners = listeners.filter((x) => x !== l)
      window.removeEventListener('hashchange', onHash)
    }
  }, [])
  return route
}
