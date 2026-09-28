import { Mark } from '../icons'
import { SITE_CONTACT } from '../constants'

type SiteFooterProps = {
  /** 完整页脚（产品/资源/关于列）；下载页可传 compact 仅底栏 */
  compact?: boolean
  versionNote?: string
  onDownload?: () => void
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

export default function SiteFooter({ compact, versionNote, onDownload }: SiteFooterProps) {
  if (compact) {
    return (
      <footer className="foot">
        <div className="wrap">
          <div className="foot-bot" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            <span>© 2026 Talos · 仅供内网使用</span>
            <span className="foot-contact">
              <a href={SITE_CONTACT.github} {...ext}>{SITE_CONTACT.githubLabel}</a>
              <span aria-hidden>·</span>
              <a href={SITE_CONTACT.mailto}>{SITE_CONTACT.email}</a>
              {versionNote ? <><span aria-hidden>·</span><span>{versionNote}</span></> : null}
            </span>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-in">
          <div className="foot-brand">
            <Mark size={24} />
            <p>Talos · 研发周期全自动流程平台<br />服务端编排，客户端执行。</p>
          </div>
          <div className="foot-col">
            <h5>产品</h5>
            <a href="#arch">架构</a>
            <a href="#feat">核心能力</a>
            <a href="#sec">安全</a>
            {onDownload ? (
              <a href="#" onClick={(e) => { e.preventDefault(); onDownload() }}>客户端下载</a>
            ) : null}
          </div>
          <div className="foot-col">
            <h5>资源</h5>
            <a href={SITE_CONTACT.github} {...ext}>GitHub 源码</a>
            <a href={`${SITE_CONTACT.github}#readme`} {...ext}>部署文档</a>
            <a href={`${SITE_CONTACT.github}/issues`} {...ext}>问题反馈</a>
            <a href={SITE_CONTACT.mailto}>联系邮箱</a>
          </div>
          <div className="foot-col">
            <h5>关于</h5>
            <a href="#">版本 1.4.3</a>
            <a href={SITE_CONTACT.github} {...ext}>{SITE_CONTACT.githubLabel}</a>
            <a href={SITE_CONTACT.mailto}>{SITE_CONTACT.email}</a>
          </div>
        </div>
        <div className="foot-bot">
          <span>© 2026 Talos · 仅供内网使用</span>
          <span className="foot-contact">
            <a href={SITE_CONTACT.github} {...ext}>{SITE_CONTACT.githubLabel}</a>
            <span aria-hidden>·</span>
            <a href={SITE_CONTACT.mailto}>{SITE_CONTACT.email}</a>
            <span aria-hidden>·</span>
            <span>构建 1.4.3 · 数据不出内网</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
