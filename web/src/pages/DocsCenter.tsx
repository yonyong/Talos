import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import SiteChrome from '../components/SiteChrome'
import { DOC_CATEGORIES, DOC_FEATURED, filterDocs } from '../docsCatalog'

/** 官网文档中心落地页（参考常见产品文档站首页） */
export default function DocsCenter() {
  const [q, setQ] = useState('')
  const hits = useMemo(() => filterDocs(q), [q])
  const searching = q.trim().length > 0

  return (
    <SiteChrome active="docs">
      <section className="docs-hero">
        <div className="wrap docs-hero-in">
          <h1>文档中心</h1>
          <p>接入、部署、架构与运维参考。从这里开始把终端接进 Talos。</p>
          <label className="docs-search">
            <Icon name="search" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索文档，例如：接入、升级、配置…"
              aria-label="搜索文档"
            />
          </label>
        </div>
      </section>

      <section className="docs-body">
        <div className="wrap">
          {searching ? (
            <div className="docs-search-results">
              <div className="docs-cat-h">
                <h2>搜索结果</h2>
                <span>{hits.length} 条</span>
              </div>
              {hits.length === 0 ? (
                <div className="docs-empty">没有匹配「{q.trim()}」的文档</div>
              ) : (
                <div className="docs-result-list">
                  {hits.map((d) => (
                    <a
                      key={d.href + d.title}
                      className="docs-result"
                      href={d.href}
                      onClick={d.onClick ? (e) => { e.preventDefault(); d.onClick?.() } : undefined}
                    >
                      <b>{d.title}</b>
                      {d.desc ? <span>{d.desc}</span> : null}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="docs-cat-h">
                <h2>开始使用</h2>
                <span>推荐入口</span>
              </div>
              <div className="docs-featured">
                {DOC_FEATURED.map((d) => (
                  <a
                    key={d.title}
                    className="docs-feat-card"
                    href={d.href}
                    onClick={d.onClick ? (e) => { e.preventDefault(); d.onClick?.() } : undefined}
                  >
                    <div className="docs-feat-ico"><Icon name={d.icon ?? 'doc'} size={20} /></div>
                    <b>{d.title}</b>
                    <span>{d.desc}</span>
                    <em>阅读文档 <Icon name="arrow" size={13} /></em>
                  </a>
                ))}
              </div>

              <div className="docs-cat-h" style={{ marginTop: 48 }}>
                <h2>按主题浏览</h2>
                <span>分类目录</span>
              </div>
              <div className="docs-cats">
                {DOC_CATEGORIES.map((c) => (
                  <div key={c.id} className="docs-cat">
                    <h3>{c.title}</h3>
                    <p>{c.desc}</p>
                    <ul>
                      {c.items.map((it) => (
                        <li key={it.href + it.title}>
                          <a
                            href={it.href}
                            onClick={it.onClick ? (e) => { e.preventDefault(); it.onClick?.() } : undefined}
                          >
                            <span>{it.title}</span>
                            {it.desc ? <small>{it.desc}</small> : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </SiteChrome>
  )
}
