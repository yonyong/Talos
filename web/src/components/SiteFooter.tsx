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
            <span>© 2026 Talos</span>
            <span className="foot-bot-right">
              <ContactIcons />
              {versionNote ? <span className="foot-meta">{versionNote}</span> : null}
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
          </div>
          <div className="foot-col">
            <h5>资源</h5>
            <a href="#/app/docs">文档中心</a>
            <a
              href="#/download"
              onClick={(e) => {
                if (!onDownload) return
                e.preventDefault()
                onDownload()
              }}
            >
              客户端下载
            </a>
          </div>
          <div className="foot-col">
            <h5>关于</h5>
            <a href="#arch">关于 Talos</a>
            <ContactIcons />
          </div>
        </div>
        <div className="foot-bot">
          <span>© 2026 Talos</span>
          <ContactIcons />
        </div>
      </div>
    </footer>
  )
}
