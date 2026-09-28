import { Mark } from '../icons'
import ContactIcons from './ContactIcons'

type SiteFooterProps = {
  /** 完整页脚（产品/资源/关于列）；下载页可传 compact 仅底栏 */
  compact?: boolean
  versionNote?: string
  onDownload?: () => void
}

export default function SiteFooter({ compact, versionNote, onDownload }: SiteFooterProps) {
  if (compact) {
    return (
      <footer className="foot">
        <div className="wrap">
          <div className="foot-bot" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            <span>© 2026 Talos · 仅供内网使用</span>
            <span className="foot-bot-right">
              <ContactIcons size="sm" />
              {versionNote ? <span>{versionNote}</span> : null}
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
            <ContactIcons />
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
            <p className="foot-col-desc">源码、文档与问题反馈</p>
            <ContactIcons size="sm" />
          </div>
          <div className="foot-col">
            <h5>关于</h5>
            <a href="#">版本 1.4.3</a>
            <a href="#sec">内网部署说明</a>
            <p className="foot-col-desc">联系作者</p>
            <ContactIcons size="sm" />
          </div>
        </div>
        <div className="foot-bot">
          <span>© 2026 Talos · 仅供内网使用</span>
          <span className="foot-bot-right">
            <ContactIcons size="sm" />
            <span>构建 1.4.3 · 数据不出内网</span>
          </span>
        </div>
      </div>
    </footer>
  )
}
