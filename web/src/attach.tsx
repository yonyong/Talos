import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Modal } from './ui'
import { docRawUrl, fetchDocText, fmtBytes } from './api'
import type { DocItem } from './types'

/* =========================================================================
 * 附件：提出 Issue 时上传的原始材料（截图 / 日志 / 需求稿）
 * 三种入口等价 —— Ctrl+V 粘贴、拖拽、点选文件，都落到同一份待上传列表
 * ========================================================================= */

/** 待上传文件：key 用于列表渲染与移除，preview 仅图片有（本地 objectURL） */
export interface PendingFile {
  key: string
  file: File
  preview?: string
}

const MAX = 20 * 1024 * 1024 // 与服务端 20MB 上限保持一致

let seq = 0
const nextKey = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`

/** 粘贴的截图浏览器统一命名为 image.png，改成可读的时间戳名 */
function renamePasted(f: File): File {
  if (!/^image\.(png|jpe?g)$/i.test(f.name || '')) return f
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ext = f.name.toLowerCase().endsWith('jpg') ? 'jpg' : 'png'
  const name = `截图 ${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
  try {
    return new File([f], name, { type: f.type })
  } catch {
    return f // 少数浏览器不支持 File 构造，保留原名
  }
}

/**
 * 图片预览地址按 File 缓存：向导切步会卸载重挂组件，
 * 若在卸载时 revoke 会导致新实例里的缩略图破图，这里随页面生命周期自然释放。
 */
const previewCache = new WeakMap<File, string>()
function previewUrl(f: File): string | undefined {
  if (!f.type.startsWith('image/')) return undefined
  let u = previewCache.get(f)
  if (!u) {
    u = URL.createObjectURL(f)
    previewCache.set(f, u)
  }
  return u
}

function toPending(files: File[]): PendingFile[] {
  return files
    .filter((f) => f.size <= MAX)
    .map((f) => ({ key: nextKey(), file: f, preview: previewUrl(f) }))
}

/**
 * 附件区：粘贴 / 拖拽 / 点选三合一，文件暂存在本地，提交 Issue 时统一上传。
 */
export function AttachPane({
  files, onChange, onReject, disabled, hint, compact,
}: {
  files: PendingFile[]
  onChange: (next: PendingFile[]) => void
  /** 超限文件的反馈（由调用方决定如何提示） */
  onReject?: (names: string[]) => void
  disabled?: boolean
  hint?: string
  /** 紧凑模式：向导非「详情」步骤使用，仍支持粘贴 / 拖拽 / 点选 */
  compact?: boolean
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return
    const tooBig = incoming.filter((f) => f.size > MAX).map((f) => f.name || '未命名')
    if (tooBig.length && onReject) onReject(tooBig)
    const pending = toPending(incoming)
    if (pending.length) onChange([...files, ...pending])
  }

  /* 全局粘贴：只要剪贴板里有文件就接管（不干扰输入框里的纯文本粘贴） */
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const fs = Array.from(e.clipboardData?.files ?? [])
      if (fs.length === 0) return
      e.preventDefault()
      add(fs.map(renamePasted))
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, files])

  const remove = (key: string) => onChange(files.filter((f) => f.key !== key))

  if (compact) {
    return (
      <div
        className={`atch-compact${disabled ? ' off' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer?.files ?? []).map(renamePasted)) }}
      >
        <button type="button" className="ac-add" onClick={() => !disabled && inputRef.current?.click()}>
          <Icon name="upload" size={13} />附件
        </button>
        {files.length === 0
          ? <span className="ac-ph">可直接 Ctrl+V 粘贴多个文件（截图 / 日志 / 需求稿）</span>
          : files.map((f) => (
            <span key={f.key} className="ac-chip" title={f.file.name}>
              {f.preview && <img src={f.preview} alt="" />}
              <span className="ac-n">{f.file.name}</span>
              <button type="button" className="iconbtn xs" title="移除" onClick={() => remove(f.key)}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = '' }}
        />
      </div>
    )
  }

  return (
    <div>
      <div
        className={`atch-drop${over ? ' over' : ''}${disabled ? ' off' : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(Array.from(e.dataTransfer?.files ?? []).map(renamePasted))
        }}
      >
        <Icon name="upload" size={16} />
        <div className="at-t">把文件拖到这里，或直接 Ctrl+V 粘贴</div>
        <div className="at-s">支持多个文件 · 截图 / 日志 / 需求稿 · 单个不超过 20MB</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="atch-list">
          {files.map((f) => (
            <div key={f.key} className="atch-item">
              {f.preview
                ? <img className="at-thumb" src={f.preview} alt="" />
                : <span className="at-ficon"><Icon name="file" size={13} /></span>}
              <span className="at-name" title={f.file.name}>{f.file.name}</span>
              <span className="at-size">{fmtBytes(f.file.size)}</span>
              <button
                type="button"
                className="iconbtn xs"
                title="移除"
                onClick={(e) => { e.stopPropagation(); remove(f.key) }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {hint && <div className="fhelp">{hint}</div>}
    </div>
  )
}

/* =========================================================================
 * 文档展示：详情页按「原始材料 / 过程文档」分栏使用
 * ========================================================================= */

/** 预览能力判定：图片 / 文本可在线看，其余只能下载 */
export function previewKind(d: DocItem): 'image' | 'text' | 'file' {
  const m = (d.mime ?? '').toLowerCase()
  const ext = (d.name.split('.').pop() ?? '').toLowerCase()
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (m.startsWith('text/') || m.includes('json') || m.includes('xml')) return 'text'
  if (['txt', 'md', 'log', 'csv', 'yml', 'yaml', 'ini', 'json', 'xml', 'java', 'py', 'js', 'ts', 'sql', 'sh'].includes(ext)) return 'text'
  if (d.hasText) return 'text'
  return 'file'
}

/**
 * 文档列表：点击行预览（图片/文本），非文本类直接下载。
 */
export function DocList({
  docs, empty, onDelete, onChanged,
}: {
  docs: DocItem[]
  empty?: string
  /** 传了才显示删除按钮（原始材料可撤回） */
  onDelete?: (d: DocItem) => Promise<void> | void
  onChanged?: () => void
}) {
  const [open, setOpen] = useState<DocItem | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  if (docs.length === 0) {
    return <div className="id-muted">{empty ?? '暂无文档'}</div>
  }

  const del = async (d: DocItem) => {
    if (!onDelete) return
    setBusy(d.id ?? null)
    try {
      await onDelete(d)
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="doclist">
        {docs.map((d, i) => {
          const k = previewKind(d)
          return (
            <div key={d.id ?? i} className="doc-row">
              {k === 'image' && d.id != null
                ? <img className="doc-thumb" src={docRawUrl(d.id)} alt="" onClick={() => setOpen(d)} />
                : <span className="doc-ico"><Icon name={k === 'text' ? 'doc' : 'file'} size={13} /></span>}
              <div className="doc-main" onClick={() => setOpen(d)}>
                <div className="doc-name" title={d.name}>{d.name}</div>
                <div className="doc-sub">
                  {d.size} · {d.time}
                  {d.uploader ? ` · ${d.uploader}` : d.from && d.from !== '—' ? ` · ${d.from}` : ''}
                </div>
              </div>
              <div className="doc-ops">
                {d.id != null && (
                  <a
                    className="iconbtn xs"
                    title="下载"
                    href={docRawUrl(d.id, true)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="download" size={12} />
                  </a>
                )}
                {onDelete && d.id != null && (
                  <button
                    type="button"
                    className="iconbtn xs"
                    title="删除"
                    disabled={busy === d.id}
                    onClick={() => del(d)}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {open && <DocPreview doc={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** 文档预览：图片直接渲染，文本读取全文，其余给出下载入口 */
export function DocPreview({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  const k = previewKind(doc)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (k !== 'text' || doc.id == null) return
    let alive = true
    fetchDocText(doc.id)
      .then((t) => { if (alive) setText(t) })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [doc.id, k])

  return (
    <Modal
      title={doc.name}
      width={880}
      height="76vh"
      onClose={onClose}
      footer={
        <>
          {doc.id != null && (
            <a className="btn btn-outline btn-sm" href={docRawUrl(doc.id, true)} target="_blank" rel="noreferrer">
              <Icon name="download" size={13} />下载原文件
            </a>
          )}
          <button className="btn btn-primary btn-sm" onClick={onClose}>关闭</button>
        </>
      }
    >
      <div className="docpv-meta">
        <span>{doc.kind}</span>
        <span>{doc.size}</span>
        <span>{doc.time}</span>
        {doc.uploader && <span>上传者 {doc.uploader}</span>}
        {doc.from && doc.from !== '—' && <span>{doc.from}</span>}
      </div>
      {k === 'image' && doc.id != null && (
        <div className="docpv-img">
          <img src={docRawUrl(doc.id)} alt={doc.name} />
        </div>
      )}
      {k === 'text' && (
        <pre className="docpv-text">{text ?? (err ? `读取失败：${err}` : '加载中…')}</pre>
      )}
      {k === 'file' && doc.id != null && (
        <div className="docpv-file">
          <Icon name="file" size={22} />
          <div>该文件类型不支持在线预览，请下载后查看。</div>
        </div>
      )}
    </Modal>
  )
}
