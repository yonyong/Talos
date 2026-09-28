import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Panel, Tag, useToast } from '../ui'
import { activateAgentRelease, deleteAgentReleaseFile, fetchAgentReleaseList, uploadAgentRelease } from '../api'
import type { AgentReleaseList } from '../types'

function sizeText(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function shortSha(sha?: string): string {
  if (!sha) return '—'
  return sha.length <= 20 ? sha : `${sha.slice(0, 8)}…${sha.slice(-6)}`
}

/** 控制台：客户端发布包版本库管理（从接入指南迁出） */
export default function AgentReleasePanel() {
  const { toast } = useToast()
  const [rel, setRel] = useState<AgentReleaseList | null>(null)
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadRel = () => fetchAgentReleaseList().then(setRel).catch(() => setRel(null))
  useEffect(() => { loadRel() }, [])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('upload')
    try {
      const r = await uploadAgentRelease(f)
      setRel(r)
      toast(`已上传 ${r.current?.fileName ?? f.name}，当前生效版本 ${r.current?.version ?? '—'}`)
    } catch (err: any) {
      toast(err?.message ?? '上传失败')
    } finally {
      setBusy('')
    }
  }

  const activate = async (version: string) => {
    setBusy('act-' + version)
    try {
      setRel(await activateAgentRelease(version))
      toast(`当前生效版本已切换为 ${version}`)
    } catch (err: any) {
      toast(err?.message ?? '操作失败')
    } finally {
      setBusy('')
    }
  }

  const removeFile = async (it: { fileName: string; version: string; current?: boolean }) => {
    if (!window.confirm(`确认删除 ${it.fileName}（${it.version}）？${it.current ? '它是当前生效版本，删除后将自动回落到版本最高的安装包。' : ''}`)) return
    setBusy('del-' + it.fileName)
    try {
      setRel(await deleteAgentReleaseFile(it.fileName))
      toast(`已删除 ${it.fileName}`)
    } catch (err: any) {
      toast(err?.message ?? '删除失败')
    } finally {
      setBusy('')
    }
  }

  const cur = rel?.current ?? null
  const curUrl = cur?.downloadUrl ?? '/api/agent/release/download'

  return (
    <Panel
      title="客户端版本"
      sub="上传维护发布版本库；「当前生效」版本对下载页与静默升级生效，可回退"
      actions={
        <>
          <input ref={fileRef} type="file" accept=".jar,.zip" style={{ display: 'none' }} onChange={onUpload} />
          <button className="btn btn-primary btn-sm" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} />{busy === 'upload' ? '上传中…' : '上传新版本'}
          </button>
        </>
      }
    >
      {!rel || !rel.available ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.8 }}>
          版本库为空。点右上角「上传新版本」上传 <code style={{ fontFamily: 'var(--mono)' }}>talos-agent-&lt;版本&gt;.jar / .zip</code>，
          或执行 <code style={{ fontFamily: 'var(--mono)' }}>client\build-package.bat</code> 后把产物放进发布目录。
        </div>
      ) : (
        <>
          <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>当前生效版本</div>
              <div style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', fontFamily: 'var(--mono)', marginTop: 2 }}>
                v{cur?.version}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 260, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.8, fontFamily: 'var(--mono)' }}>
              {cur?.fileName} · {sizeText(cur?.size)}<br />
              SHA256 {shortSha(cur?.sha256)}<br />
              发布于 {cur?.updatedAt}
            </div>
            <a className="btn btn-primary btn-sm" href={curUrl} download onClick={() => toast(`开始下载 ${cur?.fileName}`)}>
              <Icon name="download" size={15} />下载安装包
            </a>
          </div>

          {rel.versions.length > 1 && (
            <table style={{ marginTop: 16 }}>
              <thead>
                <tr><th>版本</th><th>文件</th><th>大小</th><th>更新时间</th><th style={{ width: 200 }}>操作</th></tr>
              </thead>
              <tbody>
                {rel.versions.map((it) => (
                  <tr key={it.fileName}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                      {it.version} {it.current && <Tag tone="ok">当前生效</Tag>}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{it.fileName}</td>
                    <td style={{ fontSize: 12.5 }}>{sizeText(it.size)}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{it.updatedAt}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!it.current && (
                          <button className="btn btn-outline btn-xs" disabled={busy === 'act-' + it.version} onClick={() => activate(it.version)}>
                            设为当前
                          </button>
                        )}
                        <a className="btn btn-outline btn-xs" href={`${it.downloadUrl}?version=${encodeURIComponent(it.version)}`} download>
                          下载
                        </a>
                        <button className="btn btn-outline btn-xs" disabled={busy === 'del-' + it.fileName} onClick={() => removeFile(it)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7 }}>
            版本库目录：<code style={{ fontFamily: 'var(--mono)' }}>{rel.releaseDir}</code>
            （配置项 <code style={{ fontFamily: 'var(--mono)' }}>talos.agent.release-dir</code>）。
          </div>
        </>
      )}
    </Panel>
  )
}
