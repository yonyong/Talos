import { Mark } from '../icons'
import { navigate } from '../router'

export type SiteNavKey = 'home' | 'docs' | 'download' | 'about' | 'contact'

/** 官网统一顶栏：左上角 logo 始终可点击回到首页，导航项在所有页面保持一致 */
const ITEMS: { key: SiteNavKey; label: string; hash: string }[] = [
  { key: 'home', label: '首页', hash: '#/' },
  { key: 'docs', label: '文档', hash: '#/docs' },
  { key: 'download', label: '下载', hash: '#/download' },
  { key: 'about', label: '关于', hash: '#/about' },
]

type SiteNavProps = {
  active?: SiteNavKey
  /** 右侧操作区；不传则使用默认「联系我们 + 进入控制台」 */
  right?: React.ReactNode
}

export default function SiteNav({ active, right }: SiteNavProps) {
  const go = (hash: string) => {
    window.location.hash = hash
    window.scrollTo(0, 0)
  }

  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); go('#/') }} aria-label="Talos 首页">
          <Mark />Talos
        </a>
        <nav className="nav-links">
          {ITEMS.map((it) => (
            <a
              key={it.key}
              href={it.hash}
              className={active === it.key ? 'active' : undefined}
              onClick={(e) => { e.preventDefault(); go(it.hash) }}
            >
              {it.label}
            </a>
          ))}
        </nav>
        <div className="nav-cta">
          {right ?? (
            <>
              <a className="ghost" href="#/contact" onClick={(e) => { e.preventDefault(); go('#/contact') }}>联系我们</a>
              <button className="btn btn-primary btn-sm" onClick={() => navigate({ view: 'login' })}>进入控制台</button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
