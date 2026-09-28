import { Icon } from '../icons'
import { SITE_CONTACT } from '../constants'

type ContactIconsProps = {
  /** sm：页脚底栏 / 文末；md：品牌区与「关于」列 */
  size?: 'sm' | 'md'
  className?: string
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

/** GitHub / 邮箱图标入口（无文字，靠 title + aria-label） */
export default function ContactIcons({ size = 'md', className = '' }: ContactIconsProps) {
  const icon = size === 'sm' ? 16 : 18
  return (
    <div className={`contact-icons contact-icons-${size} ${className}`.trim()} role="group" aria-label="联系方式">
      <a
        className="contact-ico"
        href={SITE_CONTACT.github}
        {...ext}
        title={`GitHub · ${SITE_CONTACT.github.replace(/^https?:\/\//, '')}`}
        aria-label="GitHub 仓库"
      >
        <Icon name="github" size={icon} />
      </a>
      <a
        className="contact-ico"
        href={SITE_CONTACT.mailto}
        title={SITE_CONTACT.email}
        aria-label={`发送邮件至 ${SITE_CONTACT.email}`}
      >
        <Icon name="mail" size={icon} />
      </a>
    </div>
  )
}
