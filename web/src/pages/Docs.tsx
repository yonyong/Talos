import { useState } from 'react'
import { Icon } from '../icons'
import { Chips, Kpi, PageH, Tag } from '../ui'
import { DocPreview } from '../attach'
import { fetchDocs, useAsync } from '../api'
import type { DocItem, PageFocus, PageKey } from '../types'

const KINDS = ['概要', '详设', '故障报告', '修复方案', '测试报告', '原始材料']

export default function Docs({ nav }: { nav: (p: PageKey, f?: PageFocus) => void }) {
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState<DocItem | null>(null)
  const { data: docs, loading } = useAsync<DocItem[]>(() => fetchDocs(kind === 'all' ? {} : { kind }), [kind])

  const list = docs ?? []
  const byKind = (k: string) => (kind === 'all' ? list.length : list.filter((d) => d.kind === k).length)

  return (
    <div>
      <PageH title="文档中心" desc="工作流产出的过程文档与 Issue 提出时上传的原始材料，服务端集中可见。" />

      <div
        className="card card-pad"
        style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, cursor: 'pointer' }}
        onClick={() => nav('guide')}
      >
        <div className="dicon"><Icon name="network" size={19} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 620 }}>接入指南</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 4 }}>
            客户端安装、连接机制、消息契约、配置字段与常见故障 —— 平台级说明文档，非工作流产出的过程文档。
          </div>
        </div>
        <Icon name="arrow" size={15} />
      </div>

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="doc" label="文档总数" value={String(list.length)} delta="服务端归档" dir="up" />
        <Kpi icon="download" label="本月回传" value={String(list.length)} delta="全部成功" dir="up" color="#16a34a" glow="rgba(22,163,74,.2)" />
        <Kpi icon="layers" label="来源" value={String(new Set(list.map((d) => d.issue)).size)} delta="按 Issue 维度" dir="flat" color="#0891b2" glow="rgba(8,145,178,.2)" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Chips
          value={kind}
          onChange={setKind}
          items={[
            { v: 'all', l: '全部', n: list.length },
            ...KINDS.map((k) => ({ v: k, l: k === '概要' ? '需求概要' : k === '详设' ? '详细设计' : k, n: byKind(k) })),
          ]}
        />
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && docs === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && docs !== null && (
        list.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 24, textAlign: 'center' }}>暂无文档（客户端执行工作流后回传）</div>
        ) : (
          <div className="grid g3">
            {list.map((d, i) => (
              <div key={i} className="card doccard" onClick={() => setOpen(d)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="dicon"><Icon name="doc" size={19} /></div>
                  <Tag tone="mut">{d.issue}</Tag>
                </div>
                <b>{d.name}</b>
                <span className="dsub">{d.category === 'RAW' ? `原始材料 · ${d.uploader || d.from}` : d.from}</span>
                <div className="dmeta"><Icon name="clock" size={13} /> {d.time} · {d.size}</div>
              </div>
            ))}
          </div>
        )
      )}

      {open && <DocPreview doc={open} onClose={() => setOpen(null)} />}

      <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-4)' }}>
        文档由端侧 Coding Agent 生成（需读取本地代码），经 UploadArtifact 通道回传服务端，按 Issue 维度归档。
      </div>
    </div>
  )
}
