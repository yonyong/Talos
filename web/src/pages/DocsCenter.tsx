import { Icon } from '../icons'
import SiteChrome from '../components/SiteChrome'

const DOCS: { href: string; icon: string; title: string; desc: string; onClick?: () => void }[] = [
  {
    href: '#/docs/guide',
    icon: 'network',
    title: '接入指南',
    desc: '客户端安装、连接机制、消息契约、配置字段与常见故障。',
  },
  {
    href: '#/download',
    icon: 'download',
    title: '客户端下载',
    desc: '获取 Windows 安装包，完成终端接入与静默升级。',
  },
  {
    href: '#/',
    icon: 'layers',
    title: '系统架构',
    desc: '反向长连接、服务端编排与端侧 Coding Agent 的整体结构。',
    onClick: () => {
      window.location.hash = '#/'
      setTimeout(() => document.getElementById('arch')?.scrollIntoView({ behavior: 'smooth' }), 80)
    },
  },
]

/** 官网文档中心（产品文档入口，不是控制台「过程文档」） */
export default function DocsCenter() {
  return (
    <SiteChrome active="docs">
      <section className="block site-page">
        <div className="wrap">
          <div className="sec-head">
            <div className="sec-tag">资源</div>
            <div className="sec-h">文档中心</div>
            <p className="sec-p">接入、部署与架构说明。控制台内的过程文档仍在登录后的「过程文档」页查看。</p>
          </div>
          <div className="docs-hub">
            {DOCS.map((d) => (
              <a
                key={d.title}
                className="docs-hub-card"
                href={d.href}
                onClick={d.onClick ? (e) => { e.preventDefault(); d.onClick?.() } : undefined}
              >
                <div className="dicon"><Icon name={d.icon} size={20} /></div>
                <div className="docs-hub-body">
                  <b>{d.title}</b>
                  <span>{d.desc}</span>
                </div>
                <Icon name="arrow" size={15} />
              </a>
            ))}
          </div>
        </div>
      </section>
    </SiteChrome>
  )
}
