import { Icon } from '../icons'
import { SITE_CONTACT } from '../constants'
import SiteChrome from '../components/SiteChrome'

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

/** 官网「联系我们」页 */
export default function Contact() {
  return (
    <SiteChrome active="contact">
      <section className="block site-page">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="sec-head">
            <div className="sec-tag">关于</div>
            <div className="sec-h">联系我们</div>
            <p className="sec-p">问题反馈、合作或源码交流，可通过以下方式找到作者。</p>
          </div>

          <div className="contact-cards">
            <a className="contact-card" href={SITE_CONTACT.github} {...ext}>
              <span className="contact-card-ico"><Icon name="github" size={22} /></span>
              <div>
                <b>GitHub</b>
                <span>{SITE_CONTACT.github.replace(/^https?:\/\//, '')}</span>
              </div>
              <Icon name="external" size={15} />
            </a>
            <a className="contact-card" href={SITE_CONTACT.mailto}>
              <span className="contact-card-ico"><Icon name="mail" size={22} /></span>
              <div>
                <b>邮箱</b>
                <span>{SITE_CONTACT.email}</span>
              </div>
              <Icon name="external" size={15} />
            </a>
          </div>
        </div>
      </section>
    </SiteChrome>
  )
}
