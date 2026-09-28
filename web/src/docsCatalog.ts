/** 官网文档中心目录（文档落地页 + 侧栏共用） */

export type DocLink = {
  href: string
  title: string
  desc?: string
  icon?: string
  keywords?: string[]
  onClick?: () => void
}

export type DocCategory = {
  id: string
  title: string
  desc: string
  items: DocLink[]
}

const goArch = () => {
  window.location.hash = '#/'
  setTimeout(() => document.getElementById('arch')?.scrollIntoView({ behavior: 'smooth' }), 80)
}

/** 文档首页精选入口 */
export const DOC_FEATURED: DocLink[] = [
  {
    href: '#/docs/guide',
    icon: 'network',
    title: '接入指南',
    desc: '从安装到上线：连接机制、配置字段与排障。',
    keywords: ['接入', '安装', '客户端', 'guide'],
  },
  {
    href: '#/download',
    icon: 'download',
    title: '客户端下载',
    desc: '获取 Windows 安装包，完成终端接入。',
    keywords: ['下载', '安装包', 'windows'],
  },
  {
    href: '#/',
    icon: 'layers',
    title: '系统架构',
    desc: '反向长连接、服务端编排与端侧 Agent。',
    keywords: ['架构', 'gRPC', '长连接'],
    onClick: goArch,
  },
]

/** 分类浏览 */
export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: 'start',
    title: '快速开始',
    desc: '把第一台研发终端接进 Talos',
    items: [
      { href: '#/docs/guide/install', title: '三步接入', desc: '解压、安装、确认在线' },
      { href: '#/docs/guide/scripts', title: '一键脚本', desc: 'install / start / upgrade / uninstall' },
      { href: '#/download', title: '下载安装包', desc: 'Windows x64 发布版' },
    ],
  },
  {
    id: 'concepts',
    title: '核心概念',
    desc: '理解平台如何运转',
    items: [
      { href: '#/', title: '系统架构', desc: '服务端 · 终端 · Coding Agent', onClick: goArch },
      { href: '#/docs/guide/connect', title: '连接机制', desc: '反向长连接与心跳' },
      { href: '#/docs/guide/protocol', title: '消息契约', desc: 'REGISTER / TASK / CONFIG_PUSH' },
    ],
  },
  {
    id: 'ops',
    title: '运维参考',
    desc: '配置、升级与排障',
    items: [
      { href: '#/docs/guide/config', title: '客户端配置', desc: 'conf/agent.yml 字段说明' },
      { href: '#/docs/guide/upgrade', title: '静默升级', desc: '服务端驱动的版本替换' },
      { href: '#/docs/guide/troubleshoot', title: '常见故障', desc: '掉线、签名失败、升级异常' },
    ],
  },
]

/** 接入指南侧栏目录 */
export const GUIDE_TOC: { id: string; title: string }[] = [
  { id: 'connect', title: '连接机制' },
  { id: 'install', title: '三步接入' },
  { id: 'scripts', title: '一键脚本' },
  { id: 'upgrade', title: '静默升级' },
  { id: 'protocol', title: '消息契约' },
  { id: 'logs', title: '运行日志' },
  { id: 'config', title: '客户端配置' },
  { id: 'exec', title: '执行参数' },
  { id: 'troubleshoot', title: '常见故障' },
]

export function filterDocs(q: string): DocLink[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const all: DocLink[] = [
    ...DOC_FEATURED,
    ...DOC_CATEGORIES.flatMap((c) => c.items),
  ]
  const seen = new Set<string>()
  return all.filter((d) => {
    const key = d.href + d.title
    if (seen.has(key)) return false
    seen.add(key)
    const hay = [d.title, d.desc, ...(d.keywords ?? [])].join(' ').toLowerCase()
    return hay.includes(s)
  })
}
