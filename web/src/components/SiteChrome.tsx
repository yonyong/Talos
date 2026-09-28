import { Mark } from '../icons'
import { navigate } from '../router'
import SiteFooter from './SiteFooter'

export type SiteNavKey = 'home' | 'docs' | 'download' | 'about' | 'contact'

type SiteChromeProps = {
  active?: SiteNavKey
  children: React.ReactNode
  /** compact footer（下载页） */
  footerCompact?: boolean
  footerVersionNote?: string
}

/** 官网公共壳：顶栏 + 内容 + 页脚 */
export default function SiteChrome({ active, children, footerCompact, footerVersionNote }: SiteChromeProps) {
  const go = (hash: string) => {
    window.location.hash = hash
    window.scrollTo(0, 0)
  }

  return (
    <div className="site">
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go('#/') }}>
            <Mark />Talos
          </a>
          <nav className="nav-links">
            <a href="#/" className={active === 'home' ? 'active' : undefined} onClick={(e) => { e.preventDefault(); go('#/') }}>官网</a>
            <a href="#/docs" className={active === 'docs' ? 'active' : undefined} onClick={(e) => { e.preventDefault(); go('#/docs') }}>文档中心</a>
            <a href="#/download" className={active === 'download' ? 'active' : undefined} onClick={(e) => { e.preventDefault(); go('#/download') }}>下载</a>
            <a href="#/about" className={active === 'about' ? 'active' : undefined} onClick={(e) => { e.preventDefault(); go('#/about') }}>关于</a>
          </nav>
          <div className="nav-cta">
            <a className="ghost" href="#/contact" onClick={(e) => { e.preventDefault(); go('#/contact') }}>联系我们</a>
            <button className="btn btn-primary btn-sm" onClick={() => navigate({ view: 'login' })}>进入控制台</button>
          </div>
        </div>
      </header>
      {children}
      <SiteFooter
        compact={footerCompact}
        versionNote={footerVersionNote}
        onDownload={() => go('#/download')}
      />
    </div>
  )
}
