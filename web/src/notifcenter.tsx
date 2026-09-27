/**
 * 右上角通知中心：铃铛 + 未读角标 + 下拉台账。
 *
 * 条目来自 notify.ts 的通知台账（轮询比对产出，localStorage 持久化），
 * 每条带已读/未读状态；点条目 = 标记已读 + 跳到对应页面（作业→监控，Issue→Issue 列表）。
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import {
  clearNotifs, markAllNotifRead, markNotifRead, removeNotif, unreadCount, useNotifications,
} from './notify'
import type { NotifKind } from './notify'
import type { PageFocus, PageKey } from './types'

const KIND: Record<NotifKind, { icon: string; tone: string; label: string }> = {
  jobDone: { icon: 'check', tone: 'ok', label: '作业完成' },
  jobFailed: { icon: 'warn', tone: 'err', label: '作业异常' },
  newIssue: { icon: 'issue', tone: 'info', label: '新 Issue' },
  system: { icon: 'bell', tone: 'mut', label: '系统' },
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n) }

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / N 天前 / MM-DD */
function relTime(ts: number, now: number): string {
  const d = now - ts
  if (d < 60_000) return '刚刚'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`
  const t = new Date(ts)
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  if (d < 2 * 86400_000) return `昨天 ${hm}`
  if (d < 7 * 86400_000) return `${Math.floor(d / 86400_000)} 天前`
  return `${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

export default function NotifCenter({ nav }: { nav: (p: PageKey, f?: PageFocus) => void }) {
  const list = useNotifications()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  /** 面板打开时每分钟刷新一次相对时间文案 */
  const [now, setNow] = useState(() => Date.now())
  const wrap = useRef<HTMLDivElement>(null)

  const unread = unreadCount(list)
  const shown = tab === 'unread' ? list.filter((n) => !n.read) : list

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [open])

  const openItem = (id: string, page?: PageKey, focus?: PageFocus) => {
    markNotifRead(id)
    setOpen(false)
    if (page) nav(page, { ...(focus ?? {}), at: Date.now() })
  }

  return (
    <div className="notif-wrap" ref={wrap}>
      <button
        className={`iconbtn notif-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        title={unread ? `${unread} 条未读通知` : '通知中心'}
      >
        <Icon name="bell" size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-h">
            <div className="notif-t">
              通知
              {unread > 0 && <span className="notif-unread">{unread} 条未读</span>}
            </div>
            <div className="notif-acts">
              <button className="notif-act" disabled={unread === 0} onClick={markAllNotifRead}>全部已读</button>
              <button className="iconbtn notif-act-ic" disabled={list.length === 0} onClick={clearNotifs} title="清空全部">
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>

          <div className="notif-tabs">
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>全部 {list.length}</button>
            <button className={tab === 'unread' ? 'on' : ''} onClick={() => setTab('unread')}>未读 {unread}</button>
          </div>

          <div className="notif-list">
            {shown.length === 0 ? (
              <div className="notif-empty">
                <Icon name="bell" size={26} />
                <div>{tab === 'unread' ? '没有未读通知' : '暂无通知'}</div>
                <span>开启「设置 → 通知提醒」后，作业完成、异常与新 Issue 会在这里出现</span>
              </div>
            ) : shown.map((n) => {
              const k = KIND[n.kind] ?? KIND.system
              return (
                <div
                  key={n.id}
                  className={`notif-i ${n.read ? '' : 'unread'}`}
                  onClick={() => openItem(n.id, n.page, n.focus)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(n.id, n.page, n.focus) } }}
                >
                  <span className={`notif-ic t-${k.tone}`}><Icon name={k.icon} size={14} /></span>
                  <div className="notif-body">
                    <div className="notif-l1">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-time">{relTime(n.ts, now)}</span>
                    </div>
                    <div className="notif-text">{n.body}</div>
                    <div className="notif-l2">
                      <span className="notif-kind">{k.label}</span>
                      {n.page && <span className="notif-go">查看<Icon name="arrow" size={11} /></span>}
                    </div>
                  </div>
                  <span className="notif-dot" title={n.read ? '已读' : '未读'} />
                  <button
                    className="iconbtn notif-del"
                    title="删除这条通知"
                    onClick={(e) => { e.stopPropagation(); removeNotif(n.id) }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
