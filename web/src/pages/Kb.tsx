import { useState } from 'react'
import { Icon } from '../icons'
import { Kpi, Modal, PageH, Panel, Search, Tag, useToast } from '../ui'
import { fetchKb, fetchKbDetail, searchKb, useAsync } from '../api'
import type { KbDoc } from '../types'

export default function Kb() {
  const { toast } = useToast()
  const [q, setQ] = useState('快照导出规范')
  const [detail, setDetail] = useState<KbDoc | null>(null)
  const { data: kbDocs, loading } = useAsync<KbDoc[]>(() => fetchKb(), [])
  const { data: recall, loading: searching } = useAsync<{ doc: string; sim: number; text: string }[]>(
    () => (q.trim() ? searchKb(q.trim()) : Promise.resolve([])),
    [q],
  )

  const docs = kbDocs ?? []
  const hits = recall ?? []

  const openDetail = async (name: string) => {
    try {
      const d = await fetchKbDetail(name)
      setDetail(d)
    } catch (e) {
      toast(`加载详情失败：${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div>
      <PageH
        title="知识库"
        desc="准入判定与项目分拣的知识来源，支持上传与检索测试。"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => toast('已打开上传')}><Icon name="upload" size={15} />上传文档</button>
            <button className="btn btn-primary btn-sm" onClick={() => toast('已触发向量化')}>重建索引</button>
          </>
        }
      />

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="doc" label="文档数" value={String(docs.length)} delta={`切分 ${docs.reduce((s, d) => s + d.chunks, 0)}`} dir="up" />
        <Kpi icon="db" label="向量化" value="已完成" delta="pgvector" dir="up" color="#16a34a" />
        <Kpi icon="search" label="检索命中" value={hits.length ? `${hits.length} 条` : '—'} delta="实时召回" dir="up" color="#0891b2" />
      </div>

      <Panel title="检索测试" sub="模拟准入判定时的知识召回">
        <Search placeholder="检索测试：如「快照导出规范」「夜盘丢包」" value={q} onChange={setQ} />
        <div style={{ marginTop: 18 }}>
          {searching && <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>召回中…</div>}
          {!searching && hits.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>输入关键词查看召回结果</div>}
          {hits.map((r, i) => (
            <div key={r.doc} className="row-between" style={{ cursor: 'pointer' }} onClick={() => openDetail(r.doc)}>
              <div className="rl">
                <b>{i + 1}. {r.doc}</b>
                <span>{r.text ? `分类：${r.text}` : '相似度召回'}</span>
              </div>
              <Tag tone={r.sim >= 0.85 ? 'ok' : 'info'}>{r.sim.toFixed(2)}</Tag>
            </div>
          ))}
        </div>
      </Panel>

      <div style={{ marginTop: 18 }}>
        <Panel title="文档索引状态" flush>
          {docs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>暂无文档</div>
          ) : (
            <table>
              <thead><tr><th>文档</th><th>分类</th><th>切片</th><th>状态</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.name} onClick={() => openDetail(d.name)} style={{ cursor: 'pointer' }}>
                    <td>{d.name}</td>
                    <td>{d.cat}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{d.chunks}</td>
                    <td><Tag tone={d.status === '已索引' ? 'ok' : d.status === '索引中' ? 'prog' : 'err'} dot>{d.status}</Tag></td>
                    <td>
                      <button className="btn btn-xs btn-outline" onClick={(e) => { e.stopPropagation(); toast(`重建 ${d.name} 索引`) }}>重建</button>
                      <button className="btn btn-xs btn-outline" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); openDetail(d.name) }}>查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {detail && (
        <Modal
          title={detail.name}
          width={720}
          onClose={() => setDetail(null)}
          footer={<button className="btn btn-primary btn-sm" onClick={() => setDetail(null)}>关闭</button>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <Tag tone="info">{detail.cat}</Tag>
            <span style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>切片数：<b style={{ fontFamily: 'var(--mono)' }}>{detail.chunks}</b></span>
            <Tag tone={detail.status === '已索引' ? 'ok' : detail.status === '索引中' ? 'prog' : 'err'} dot>{detail.status}</Tag>
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>文档内容</label>
            <div className="codeblk" style={{ maxHeight: 420 }}>{detail.content || '（暂无内容）'}</div>
          </div>
        </Modal>
      )}
    </div>
  )
}
