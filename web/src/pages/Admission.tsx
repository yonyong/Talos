import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { Kpi, PageH, Panel, Ring, Tag, useToast } from '../ui'
import { fetchAdmissions, fetchIssues, overrideAdmission, judgeAdmission, reopenIssue, useAsync } from '../api'
import type { Admission, Issue } from '../types'

export default function Admission() {
  const { toast } = useToast()
  const { data: admissions, loading, reload } = useAsync<Admission[]>(() => fetchAdmissions(), [])
  const { data: issues, reload: reloadIssues } = useAsync<Issue[]>(() => fetchIssues(), [])
  const [cur, setCur] = useState<Admission | null>(null)
  const [override, setOverride] = useState<Record<string, 'admit' | 'reject'>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (admissions && admissions.length && !cur) setCur(admissions[0])
  }, [admissions, cur])

  const queue = admissions ?? []
  const admitted = (issues ?? []).filter((i) => i.status === 'admitted').length
  const rejected = (issues ?? []).filter((i) => i.status === 'rejected')
  const rejectedCount = rejected.length

  const resultOf = (a: Admission) => override[a.issueId] ?? a.result

  const doOverride = async (code: string, result: 'admit' | 'reject') => {
    setBusy(true)
    try {
      const updated = await overrideAdmission(code, result)
      setOverride({ ...override, [code]: result })
      setCur(updated)
      reload()
      toast(`已覆写为${result === 'admit' ? '准入' : '驳回'}`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }
  const doJudge = async (code: string) => {
    setBusy(true)
    try {
      const updated = await judgeAdmission(code)
      setCur(updated)
      reload()
      toast(`已重新判定：${updated.result}`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }
  /** 已驳回的 Issue 重新走一遍准入（不带补充描述；要补材料去 Issue 详情） */
  const doReopen = async (code: string) => {
    setBusy(true)
    try {
      const r = await reopenIssue(code)
      reload()
      reloadIssues()
      toast(r.admissionResult === 'admit' ? `${code} 已重新准入` : `${code} 重新判定仍未通过`)
    } catch (e) {
      toast(`操作失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageH title="准入判定" desc="AI 基于知识库对每条 Issue 给出准入结论，可人工覆写。" />

      <div className="grid g3" style={{ marginBottom: 18 }}>
        <Kpi icon="clock" label="待判定" value={String(queue.length)} delta="队列实时" dir="flat" />
        <Kpi icon="check" label="已准入" value={String(admitted)} delta="历史累计" dir="up" color="#16a34a" glow="rgba(22,163,74,.2)" />
        <Kpi icon="x" label="已驳回" value={String(rejectedCount)} delta="重复 / 低价值" dir="down" color="#b91c1c" glow="rgba(185,28,28,.18)" />
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>加载中…</div>}
      {!loading && admissions === null && <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>接口请求失败，请确认后端已启动（:8080）</div>}

      {!loading && admissions !== null && (
        <div className="split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Panel title="判定队列" sub={`${queue.length} 条待处理`} flush>
            {queue.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: 16 }}>队列为空</div>
            ) : (
              queue.map((a) => {
                const r = resultOf(a)
                return (
                  <div
                    key={a.issueId}
                    className={`queue ${cur?.issueId === a.issueId ? 'on' : ''}`}
                    onClick={() => setCur(a)}
                  >
                    <div className="qt">
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{a.issueId}</span>
                      {r === 'admit' ? <Tag tone="ok">准入</Tag> : r === 'reject' ? <Tag tone="err">驳回</Tag> : <Tag tone="mut" dot>判定中</Tag>}
                    </div>
                    <div className="qs">{a.title} · {a.owner}</div>
                  </div>
                )
              })
            )}
          </Panel>

          {rejected.length > 0 && (
            <Panel title={`已驳回 · ${rejected.length}`} sub="补充材料后可重新处理" flush>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', padding: '10px 16px', borderBottom: '1px solid var(--line)', lineHeight: 1.6 }}>
                驳回不是终态：按当前描述重新判定一次；若仍不通过，到 Issue 详情补充材料后再处理。
              </div>
              {rejected.map((i) => (
                <div key={i.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="qt">
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>{i.id}</span>
                      <Tag tone="err">驳回</Tag>
                    </div>
                    <div className="qs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title} · {i.owner}</div>
                  </div>
                  <button className="btn btn-outline btn-xs" disabled={busy} onClick={() => doReopen(i.id)}>重新处理</button>
                </div>
              ))}
            </Panel>
          )}
          </div>

          {cur && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Panel
                title={`${cur.issueId} · ${cur.title}`}
                sub={`责任人 ${cur.owner}`}
                actions={
                  <>
                    <button className="btn btn-outline btn-xs" onClick={() => doJudge(cur.issueId)} disabled={busy}>重新判定</button>
                    <button className="btn btn-primary btn-xs" onClick={() => doOverride(cur.issueId, 'admit')} disabled={busy}>覆写为准入</button>
                  </>
                }
              >
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 26, alignItems: 'center' }}>
                  <Ring
                    pct={Math.round((cur.confidence || 0) * 100)}
                    label={cur.confidence ? cur.confidence.toFixed(2) : '—'}
                    color={cur.confidence >= 0.9 ? '#16a34a' : cur.confidence >= 0.75 ? '#4f46e5' : '#b45309'}
                    title={<>置信度</>}
                    desc={<>阈值 0.75 · {cur.confidence >= 0.75 ? '系统据此自动准入' : '需人工确认'}</>}
                  />
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 560, marginBottom: 8 }}>判定结论</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.65 }}>{cur.reason}</div>

                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 560, marginBottom: 10 }}>命中依据</div>
                      {cur.hits.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>知识库未命中，需人工介入</div>}
                      {cur.hits.map((h) => (
                        <div key={h.doc} className="row-between">
                          <div className="rl"><b>{h.doc}</b><span>相似度 {h.sim.toFixed(2)}</span></div>
                          <span className="tag t-info">{h.sim >= 0.85 ? '强相关' : '参考'}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 20 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 560, marginBottom: 10 }}>分拣结果</div>
                      <div className="codeblk">
                        {`project: ${cur.project ?? '（待定）'}
repo:     ${cur.repo ?? '（待定）'}
workflow: ${cur.issueId.startsWith('BUG') ? 'BUG · 7 节点' : 'REQ · 7 节点'}
client:   按责任人绑定终端`}
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="判定说明" sub="规则 + 知识库 + LLM 混合">
                <div className="row-between">
                  <div className="rl"><b>知识库检索</b><span>pgvector 召回 Top-5，相似度 ≥ 0.85 记强相关</span></div>
                  <span className="tag t-info">向量</span>
                </div>
                <div className="row-between">
                  <div className="rl"><b>规则前置</b><span>重复 Issue、缺关键字段直接拦截，不调用 LLM</span></div>
                  <span className="tag t-mut">规则</span>
                </div>
                <div className="row-between">
                  <div className="rl"><b>LLM 判定</b><span>千问 / 智普公网接口，输出结论与理由</span></div>
                  <span className="tag t-mut">LLM</span>
                </div>
                <div className="row-between">
                  <div className="rl"><b>人工覆写</b><span>覆写结果写入审计日志，可追溯</span></div>
                  <Tag tone="ok">可审计</Tag>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--ink-4)' }}>
                  <Icon name="info" size={14} /> 变量缺失时会在调用日志中标记，便于排查 Prompt 模板
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
