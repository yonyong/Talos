/**
 * 控制台登录态。
 *
 * 登录方式：邮箱 + 邮件授权码（见 Login.tsx）。校验通过后服务端签发一个不透明 token，
 * 这里负责把它落到 localStorage，并给每个请求带上 Authorization: Bearer <token>。
 *
 * 为什么另存 token 而不复用 talos.profile：profile 是「个人信息」这类可编辑的展示数据，
 * 删掉/改坏它不该影响登录；token 是凭据，生命周期由服务端会话决定（失效即 401）。
 */

export interface AuthUser {
  name: string
  role: string
  /** 登录邮箱 = 用户身份：个人配置、绑定关系等都以邮箱定位 */
  email: string
  clientId?: string
  bizCodes?: string[]
}

const TOKEN_KEY = 'talos.token'
const USER_KEY = 'talos.user'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

/** 给 fetch 用的鉴权头；无 token 时返回空对象（让后端统一回 401） */
export function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/**
 * 给「浏览器直链」补 token：<img src> / <a href> / window.open 这类请求带不了自定义头，
 * 拦截器支持 ?token= 兜底，这里负责拼上。
 */
export function withToken(url: string): string {
  const t = getToken()
  if (!t) return url
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t)
}

/** 登录成功 / 退出登录时广播，订阅方（Console、通知中心）据以刷新自己持有的用户信息 */
export const AUTH_EVENT = 'talos:auth'

export function broadcastAuth() {
  window.dispatchEvent(new CustomEvent(AUTH_EVENT))
}
