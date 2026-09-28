import { useEffect, useState } from 'react'
import type { PageFocus, PageKey } from './types'

/**
 * 极简 hash 路由（零依赖）。
 *
 * 形态：
 *   #/                 品牌官网
 *   #/download         客户端下载
 *   #/docs             文档中心
 *   #/docs/guide       接入指南
 *   #/about            关于 Talos
 *   #/contact          联系我们
 *   #/login            登录
 *   #/app/<page>       控制台
 */
export type Route =
  | { view: 'landing' }
  | { view: 'download' }
  | { view: 'docs'; doc?: 'guide' }
  | { view: 'about' }
  | { view: 'contact' }
  | { view: 'login' }
  | { view: 'app'; page: PageKey; focus?: PageFocus }

/** 控制台合法页面 key（guide 已迁到官网文档中心，保留仅作旧链兼容） */
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
  if (segs[0] === 'docs') {
    if (segs[1] === 'guide') return { view: 'docs', doc: 'guide' }
    return { view: 'docs' }
  }
  if (segs[0] === 'about') return { view: 'about' }
  if (segs[0] === 'contact') return { view: 'contact' }
  if (segs[0] === 'login') return { view: 'login' }
  if (segs[0] === 'app') {
    const candidate = segs[1] as PageKey | undefined
    // 旧链 #/app/guide → 官网文档中心接入指南
    if (candidate === 'guide') return { view: 'docs', doc: 'guide' }
    const page = candidate && PAGE_KEYS.includes(candidate) ? candidate : 'dashboard'
    return { view: 'app', page, focus: focusOf() }
  }
  return { view: 'landing' }
}

export function routeToHash(r: Route): string {
  switch (r.view) {
    case 'download': return '#/download'
    case 'docs': return r.doc === 'guide' ? '#/docs/guide' : '#/docs'
    case 'about': return '#/about'
    case 'contact': return '#/contact'
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

export function navigate(r: Route, replace = false) {
  const hash = routeToHash(r)
  if (window.location.hash !== hash) {
    if (replace) window.location.replace(hash)
    else window.location.hash = hash
  }
  emit()
}

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
