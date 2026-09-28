import { useEffect, useRef, useState } from 'react'
import { Icon, Mark } from '../icons'
import { sendLoginCode, verifyLoginCode, type SendCodeResult } from '../api'
import { broadcastAuth, setAuth } from '../auth'
import { applyUserProfile } from '../settings'

/**
 * 登录：两步式「邮箱 → 邮件授权码」。
 *
 * 第一步只验证邮箱是否已绑定账号并把授权码发出去（服务端会把它当成登录身份来查 t_user.email），
 * 第二步校验授权码，通过后拿到会话 token 直接进控制台。
 *
 * 交互上刻意保留：重发倒计时、错误就地提示（不清空邮箱）、支持直接粘贴整封邮件自动取出数字。
 */
export default function Login({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<SendCodeResult | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'verify'>('')
  const [error, setError] = useState('')
  /** 重发倒计时（秒），发信成功后按服务端的 resendAfter 起算 */
  const [countdown, setCountdown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  const codeLength = sent?.codeLength || 8
  const ttlMinutes = sent ? Math.max(1, Math.round(sent.expiresIn / 60)) : 3

  useEffect(() => {
    if (countdown <= 0) return
    const t = window.setTimeout(() => setCountdown((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [countdown])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  /**
   * 取授权码。
   * @param force false = 幂等取码（有效期内沿用上一条，不重复发信）；true = 用户点「重新发送」，要新邮件
   */
  const doSend = async (force: boolean) => {
    const addr = email.trim()
    if (!addr) { setError('请输入登录邮箱'); return }
    setBusy('send')
    setError('')
    try {
      const r = await sendLoginCode(addr, force)
      setSent(r)
      setCode(r.devCode ?? '')
      setStep('code')
      setCountdown(r.resendAfter || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const doVerify = async () => {
    const c = code.trim()
    if (!c) { setError('请输入邮件中的授权码'); codeRef.current?.focus(); return }
    setBusy('verify')
    setError('')
    try {
      const r = await verifyLoginCode(email.trim(), c)
      setAuth(r.token, r.user)
      // 控制台顶栏与「个人设置」读的是 profile，登录即用服务端返回的真实身份覆盖
      applyUserProfile(r.user)
      broadcastAuth()
      onLogin()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy('')
    }
  }

  const backToEmail = () => {
    setStep('email')
    setCode('')
    setError('')
    setCountdown(0)
  }

  return (
    <div className="login">
      <div className="login-l">
        <div className="lmid">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
            <Mark size={26} />
            <span style={{ fontWeight: 600, fontSize: 16 }}>Talos</span>
          </div>
          <div className="q">为研发全流程<br />而生的<em>自动化平台</em></div>
          <div className="sec-note">
            <Icon name="lock" size={14} /> 内网部署 · 邮箱授权码登录 · 数据不出内网
          </div>
        </div>
      </div>

      <div className="login-r">
        <div className="login-card">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onBack() }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-4)', marginBottom: 22 }}
          >
            <Icon name="arrowLeft" size={14} /> 返回官网
          </a>

          {step === 'email' ? (
            <>
              <h2>登录控制台</h2>
              <div className="sub">输入已登记到 Talos 账号的邮箱，我们会把登录授权码发到该邮箱。</div>

              <div className="field">
                <label>登录邮箱</label>
                <input
                  value={email}
                  autoFocus
                  autoComplete="username"
                  placeholder="name@example.com"
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') doSend(false) }}
                />
              </div>

              {error && <div className="field-err">{error}</div>}

              <button className="btn btn-primary sso" style={{ marginTop: 22 }} disabled={busy === 'send'} onClick={() => doSend(false)}>
                {busy === 'send' ? '正在发送授权码…' : '发送授权码'}
              </button>
            </>
          ) : (
            <>
              <h2>输入授权码</h2>
              <div className="sub">
                {sent?.resent === false
                  ? <>上一封授权码仍在有效期内，可直接使用（已发送至 <strong style={{ color: 'var(--ink)' }}>{sent?.email}</strong>）。</>
                  : <>授权码已发送至 <strong style={{ color: 'var(--ink)' }}>{sent?.email}</strong>，{ttlMinutes} 分钟内有效。</>}
              </div>

              <div className="field">
                <label>授权码</label>
                <input
                  ref={codeRef}
                  className="code-input"
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={codeLength}
                  placeholder={'·'.repeat(codeLength)}
                  onChange={(e) => { setCode(e.target.value.replace(/\s/g, '')); setError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') doVerify() }}
                  onPaste={(e) => {
                    // 直接把整封邮件粘进来也能用：只取其中的数字
                    const text = e.clipboardData.getData('text') ?? ''
                    const digits = text.replace(/\D/g, '')
                    if (digits && digits !== text.trim()) {
                      e.preventDefault()
                      setCode(digits.slice(0, codeLength))
                      setError('')
                    }
                  }}
                />
              </div>

              {error && <div className="field-err">{error}</div>}

              <button className="btn btn-primary sso" style={{ marginTop: 22 }} disabled={busy === 'verify'} onClick={doVerify}>
                {busy === 'verify' ? '正在校验…' : '登录'}
              </button>

              <div className="login-div">或</div>

              <button className="btn btn-outline sso" disabled={countdown > 0 || busy === 'send'} onClick={() => doSend(true)}>
                {countdown > 0 ? `${countdown} 秒后可重新发送` : busy === 'send' ? '正在发送…' : '重新发送授权码'}
              </button>

              <div style={{ marginTop: 20, fontSize: 12.5, color: 'var(--ink-4)', textAlign: 'center' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); backToEmail() }} className="link-inline">
                  换一个邮箱
                </a>
              </div>
            </>
          )}

          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            登录即代表你同意遵守内网数据使用规范；所有操作将记录审计日志。
          </div>
        </div>
      </div>
    </div>
  )
}
