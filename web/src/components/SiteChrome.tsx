import SiteNav, { type SiteNavKey } from './SiteNav'
import SiteFooter from './SiteFooter'

type SiteChromeProps = {
  active?: SiteNavKey
  /** 右侧操作区；不传则使用默认 CTA */
  right?: React.ReactNode
  children: React.ReactNode
  /** compact footer（下载页） */
  footerCompact?: boolean
  footerVersionNote?: string
}

/** 官网公共壳：顶栏 + 内容 + 页脚 */
export default function SiteChrome({ active, right, children, footerCompact, footerVersionNote }: SiteChromeProps) {
  return (
    <div className="site">
      <SiteNav active={active} right={right} />
      {children}
      <SiteFooter
        compact={footerCompact}
        versionNote={footerVersionNote}
      />
    </div>
  )
}
