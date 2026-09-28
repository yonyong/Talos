import { useState } from 'react'
import { Mark } from '../icons'
import { Icon } from '../icons'
import { SITE_CONTACT } from '../constants'

export default function Login({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [user, setUser] = useState('yangde')
  const [pwd, setPwd] = useState('')

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
            <Icon name="lock" size={14} /> 内网部署 · mTLS 双向认证 · 数据不出内网
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
          <h2>登录控制台</h2>
          <div className="sub">使用企业账号或 SSO 登录 Talos 服务端。</div>

          <div className="field">
            <label>账号</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="工号或邮箱" />
          </div>
          <div className="field">
            <label>密码</label>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••••" />
          </div>

          <button className="btn btn-primary sso" style={{ marginTop: 24 }} onClick={onLogin}>登录</button>

          <div className="login-div">或</div>
          <button className="btn btn-outline sso" onClick={onLogin}>
            <Icon name="shield" size={16} /> 使用企业 SSO 登录
          </button>

          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            登录即代表你同意遵守内网数据使用规范；所有操作将记录审计日志。
          </div>
          <div className="foot-contact" style={{ marginTop: 18, fontSize: 12.5 }}>
            <a href={SITE_CONTACT.github} target="_blank" rel="noopener noreferrer">{SITE_CONTACT.githubLabel}</a>
            <span aria-hidden>·</span>
            <a href={SITE_CONTACT.mailto}>{SITE_CONTACT.email}</a>
          </div>
        </div>
      </div>
    </div>
  )
}
