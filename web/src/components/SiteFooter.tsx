import { Mark } from '../icons'
import ContactIcons from './ContactIcons'

type SiteFooterProps = {
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
              <ContactIcons label={false} />
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
            <a href="#/#arch" onClick={(e) => { e.preventDefault(); window.location.hash = '#/'; setTimeout(() => document.getElementById('arch')?.scrollIntoView({ behavior: 'smooth' }), 80) }}>架构</a>
            <a href="#/#feat" onClick={(e) => { e.preventDefault(); window.location.hash = '#/'; setTimeout(() => document.getElementById('feat')?.scrollIntoView({ behavior: 'smooth' }), 80) }}>核心能力</a>
            <a href="#/#sec" onClick={(e) => { e.preventDefault(); window.location.hash = '#/'; setTimeout(() => document.getElementById('sec')?.scrollIntoView({ behavior: 'smooth' }), 80) }}>安全</a>
          </div>
          <div className="foot-col">
            <h5>资源</h5>
            <a href="#/docs">文档中心</a>
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
            <a href="#/about">关于 Talos</a>
            <a href="#/contact">联系我们</a>
          </div>
        </div>
        <div className="foot-bot">
          <span>© 2026 Talos</span>
          <ContactIcons label={false} />
        </div>
      </div>
    </footer>
  )
}
