import { Icon } from '../icons'
import { SITE_CONTACT } from '../constants'

type ContactIconsProps = {
  /** 是否显示「联系我们」文案（默认显示） */
  label?: boolean | string
  className?: string
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

/** 「联系我们」+ GitHub / 邮箱图标（纯图标链，无方框） */
export default function ContactIcons({ label = '联系我们', className = '' }: ContactIconsProps) {
  const text = label === true ? '联系我们' : label === false ? '' : label
  return (
    <div className={`contact-row ${className}`.trim()} role="group" aria-label="联系方式">
      {text ? <span className="contact-label">{text}</span> : null}
      <a
        className="contact-ico"
        href={SITE_CONTACT.github}
        {...ext}
        title={`GitHub · ${SITE_CONTACT.github.replace(/^https?:\/\//, '')}`}
        aria-label="GitHub 仓库"
      >
        <Icon name="github" size={18} />
      </a>
      <a
        className="contact-ico"
        href={SITE_CONTACT.mailto}
        title={SITE_CONTACT.email}
        aria-label={`发送邮件至 ${SITE_CONTACT.email}`}
      >
        <Icon name="mail" size={18} />
      </a>
    </div>
  )
}
