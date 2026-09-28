import SiteChrome from './SiteChrome'
import { GUIDE_TOC } from '../docsCatalog'

type DocsLayoutProps = {
  doc: 'guide'
  section?: string
  children: React.ReactNode
}

/** 文档阅读布局：顶栏 + 左侧目录 + 正文 */
export default function DocsLayout({ doc, section, children }: DocsLayoutProps) {
  const toc = doc === 'guide' ? GUIDE_TOC : []

  return (
    <SiteChrome active="docs">
      <div className="docs-shell">
        <aside className="docs-side">
          <a className="docs-side-home" href="#/docs">← 文档中心</a>
          <div className="docs-side-group">接入指南</div>
          <nav className="docs-side-nav">
            {toc.map((t) => (
              <a
                key={t.id}
                href={`#/docs/guide/${t.id}`}
                className={section === t.id ? 'on' : undefined}
              >
                {t.title}
              </a>
            ))}
          </nav>
          <div className="docs-side-group">更多</div>
          <nav className="docs-side-nav">
            <a href="#/download">客户端下载</a>
            <a href="#/about">关于 Talos</a>
            <a href="#/contact">联系我们</a>
          </nav>
        </aside>
        <main className="docs-main">
          {children}
        </main>
      </div>
    </SiteChrome>
  )
}
