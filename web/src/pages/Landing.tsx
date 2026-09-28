import React, { useEffect } from 'react'
import SiteChrome from '../components/SiteChrome'

/* ---------------- 架构图（深色科技风） ---------------- */
function ArchSvg() {
  return (
    <svg className="arch-svg" viewBox="0 0 1120 352" fill="none" style={{ fontFamily: 'Inter,system-ui,sans-serif' }}>
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 Z" fill="#818cf8" />
        </marker>
        <marker id="ah2" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 Z" fill="#4ade80" />
        </marker>
      </defs>

      {/* ---- Zone 1: 服务端 ---- */}
      <rect x="60" y="60" width="250" height="210" rx="18" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.1)" />
      <text x="185" y="90" textAnchor="middle" fontSize="15" fontWeight="650" fill="#fff">Talos 服务端</text>
      <text x="185" y="108" textAnchor="middle" fontSize="11.5" fill="#71717a">编排 · 准入 · 配置</text>
      <rect x="85" y="125" width="96" height="44" rx="10" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)" />
      <text x="133" y="152" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e4e4e7">准入 / 分拣</text>
      <rect x="189" y="125" width="96" height="44" rx="10" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)" />
      <text x="237" y="152" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e4e4e7">工作流引擎</text>
      <rect x="85" y="181" width="96" height="44" rx="10" fill="rgba(99,102,241,.14)" stroke="rgba(129,140,248,.28)" />
      <text x="133" y="208" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c7d2fe">配置下发</text>
      <rect x="189" y="181" width="96" height="44" rx="10" fill="rgba(34,197,94,.1)" stroke="rgba(74,222,128,.24)" />
      <text x="237" y="208" textAnchor="middle" fontSize="12" fontWeight="600" fill="#86efac">文档 / 日志</text>

      {/* ---- Zone 2: 研发终端 ---- */}
      <rect x="420" y="60" width="270" height="210" rx="18" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.14)" />
      <text x="555" y="90" textAnchor="middle" fontSize="15" fontWeight="650" fill="#fff">研发终端</text>
      <text x="555" y="108" textAnchor="middle" fontSize="11.5" fill="#71717a">NAT 后 · 心跳 10s</text>
      <rect x="450" y="125" width="210" height="54" rx="12" fill="rgba(0,0,0,.22)" stroke="rgba(255,255,255,.12)" />
      <text x="555" y="150" textAnchor="middle" fontSize="14" fontWeight="650" fill="#fff">客户端 Daemon</text>
      <text x="555" y="168" textAnchor="middle" fontSize="11.5" fill="#a1a1aa">常驻 · 拉取任务 · 回传产物</text>
      <rect x="450" y="190" width="210" height="44" rx="10" fill="rgba(99,102,241,.12)" stroke="rgba(129,140,248,.22)" />
      <text x="555" y="217" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="#c7d2fe">多后端 Agent 适配层</text>

      {/* ---- Zone 3: Coding Agent ---- */}
      <rect x="770" y="60" width="290" height="210" rx="18" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.1)" />
      <text x="915" y="90" textAnchor="middle" fontSize="15" fontWeight="650" fill="#fff">Coding Agent 后端</text>
      <text x="915" y="108" textAnchor="middle" fontSize="11.5" fill="#71717a">多模型推理</text>
      <rect x="795" y="125" width="130" height="44" rx="10" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)" />
      <text x="860" y="152" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e4e4e7">Claude Code</text>
      <rect x="935" y="125" width="110" height="44" rx="10" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)" />
      <text x="990" y="152" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e4e4e7">Cursor</text>
      <rect x="795" y="181" width="130" height="44" rx="10" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.1)" />
      <text x="860" y="208" textAnchor="middle" fontSize="12" fontWeight="600" fill="#e4e4e7">Codex</text>
      <rect x="935" y="181" width="110" height="44" rx="10" fill="rgba(99,102,241,.16)" stroke="rgba(129,140,248,.3)" />
      <text x="990" y="208" textAnchor="middle" fontSize="12" fontWeight="600" fill="#c7d2fe">CodeBuddy</text>

      {/* ---- 连线 ---- */}
      <path className="flow" d="M318 150 H 412" stroke="#818cf8" strokeWidth="1.8" strokeDasharray="5 5" strokeLinecap="round" markerStart="url(#ah)" markerEnd="url(#ah)" />
      <text x="365" y="138" textAnchor="middle" fontSize="11" fontWeight="650" fill="#a5b4fc">gRPC 双向流</text>
      <path className="flow" d="M412 205 H 318" stroke="#4ade80" strokeWidth="1.6" strokeDasharray="5 5" strokeLinecap="round" markerEnd="url(#ah2)" />
      <text x="365" y="226" textAnchor="middle" fontSize="11" fontWeight="650" fill="#86efac">产物 / 日志回流</text>
      <path className="flow" d="M698 150 H 762" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ah)" />
      <text x="730" y="138" textAnchor="middle" fontSize="10.5" fontWeight="650" fill="#a5b4fc">调用</text>

      {/* ---- footnotes ---- */}
      <text x="185" y="308" textAnchor="middle" fontSize="11.5" fill="#52525b">内网 / 机房部署</text>
      <text x="555" y="308" textAnchor="middle" fontSize="11.5" fill="#52525b">mTLS 双向认证</text>
      <text x="915" y="308" textAnchor="middle" fontSize="11.5" fill="#52525b">敏感代码强制私有化</text>
    </svg>
  )
}

/* ---------------- Bento 插画 ---------------- */
function VisAdmission() {
  return (
    <svg viewBox="0 0 420 120" fill="none">
      <rect x="8" y="46" width="76" height="34" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="46" y="67" textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#3f3f46">Issue</text>
      <path d="M88 63 H 132" stroke="#c7d2fe" strokeWidth="1.6" strokeDasharray="4 4" />
      <rect x="136" y="40" width="72" height="40" rx="10" fill="#eef2ff" stroke="#c7d2fe" />
      <text x="172" y="64" textAnchor="middle" fontSize="11.5" fontWeight="650" fill="#4338ca">AI 判定</text>
      <path d="M208 60 C 240 60 240 22 268 22" stroke="#e4e4e7" strokeWidth="1.5" />
      <path d="M208 60 H 268" stroke="#e4e4e7" strokeWidth="1.5" />
      <path d="M208 62 C 240 62 240 98 268 98" stroke="#e4e4e7" strokeWidth="1.5" />
      <rect x="272" y="6" width="140" height="32" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="290" y="26" fontSize="11" fill="#3f3f46">quote-service</text>
      <text x="392" y="26" textAnchor="end" fontSize="10.5" fontWeight="650" fill="#4338ca">0.93</text>
      <rect x="272" y="46" width="140" height="32" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="290" y="66" fontSize="11" fill="#3f3f46">quote-gateway</text>
      <text x="392" y="66" textAnchor="end" fontSize="10.5" fontWeight="650" fill="#4338ca">0.96</text>
      <rect x="272" y="86" width="140" height="32" rx="8" fill="#fafafa" stroke="#e4e4e7" />
      <text x="290" y="106" fontSize="11" fill="#a1a1aa">account-center</text>
      <text x="392" y="106" textAnchor="end" fontSize="10.5" fontWeight="650" fill="#b45309">待定</text>
    </svg>
  )
}

function VisAgents() {
  return (
    <svg viewBox="0 0 260 220" fill="none">
      <rect x="88" y="88" width="84" height="46" rx="12" fill="#0a0a0b" />
      <text x="130" y="108" textAnchor="middle" fontSize="11.5" fontWeight="650" fill="#fff">Daemon</text>
      <text x="130" y="124" textAnchor="middle" fontSize="10" fill="#a1a1aa">适配层</text>
      <path d="M130 88 V 40" stroke="#e4e4e7" strokeWidth="1.5" />
      <path d="M130 134 V 182" stroke="#e4e4e7" strokeWidth="1.5" />
      <path d="M88 111 H 40" stroke="#e4e4e7" strokeWidth="1.5" />
      <path d="M172 111 H 220" stroke="#e4e4e7" strokeWidth="1.5" />
      <rect x="72" y="8" width="116" height="32" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="130" y="29" textAnchor="middle" fontSize="11" fontWeight="600" fill="#3f3f46">Claude Code</text>
      <rect x="72" y="180" width="116" height="32" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="130" y="201" textAnchor="middle" fontSize="11" fontWeight="600" fill="#3f3f46">Cursor</text>
      <rect x="4" y="95" width="36" height="32" rx="8" fill="#fff" stroke="#e4e4e7" />
      <text x="22" y="116" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#3f3f46">Codex</text>
      <rect x="220" y="95" width="36" height="32" rx="8" fill="#eef2ff" stroke="#c7d2fe" />
      <text x="238" y="116" textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#4338ca">CB</text>
    </svg>
  )
}

function VisWorkflow() {
  return (
    <svg viewBox="0 0 420 120" fill="none">
      <text x="6" y="18" fontSize="10.5" fontWeight="650" fill="#4338ca">需求链路</text>
      <path d="M6 40 H 384" stroke="#c7d2fe" strokeWidth="1.6" />
      {[36, 96, 156, 216, 276, 336, 384].map((x, i) => (
        <circle key={x} cx={x} cy={40} r="7" fill="#fff" stroke="#c7d2fe" strokeWidth="1.8" />
      ))}
      {['Git', '分析', '设计', '评审', '编码', '测试', '验收'].map((t, i) => (
        <text key={t} x={36 + i * 58} y="62" textAnchor="middle" fontSize="10" fill="#71717a">{t}</text>
      ))}
      <text x="6" y="92" fontSize="10.5" fontWeight="650" fill="#b45309">缺陷链路</text>
      <path d="M6 112 H 384" stroke="#fde68a" strokeWidth="1.6" />
      {[36, 96, 156, 216, 276, 336, 384].map((x) => (
        <circle key={x} cx={x} cy={112} r="7" fill="#fff" stroke="#fde68a" strokeWidth="1.8" />
      ))}
      {['Git', '定位', '方案', '评审', '修复', '测试', '验收'].map((t, i) => (
        <text key={t} x={36 + i * 58} y="102" textAnchor="middle" fontSize="10" fill="#71717a">{t}</text>
      ))}
    </svg>
  )
}

function VisObserve() {
  return (
    <svg viewBox="0 0 420 120" fill="none">
      <defs>
        <linearGradient id="obs" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#16a34a" stopOpacity="0.16" />
          <stop offset="1" stopColor="#16a34a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M10 88 L60 74 L110 80 L160 52 L210 62 L260 34 L310 44 L360 20 L410 28" stroke="#16a34a" strokeWidth="1.8" fill="none" />
      <path d="M10 88 L60 74 L110 80 L160 52 L210 62 L260 34 L310 44 L360 20 L410 28 L410 108 L10 108 Z" fill="url(#obs)" />
      <circle cx="360" cy="20" r="4" fill="#16a34a" />
      <text x="352" y="12" textAnchor="end" fontSize="10.5" fontWeight="650" fill="#15803d">1284</text>
      <text x="10" y="102" fontSize="10" fill="#a1a1aa">调用量 / 成本 / 耗时 实时回传</text>
    </svg>
  )
}

/* ---------------- Landing ---------------- */
export default function Landing({ onEnter }: { onEnter: () => void }) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!els.length) return
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <SiteChrome active="home">
      <header className="hero">
        <div className="hero-grid" />
        <div className="hero-glow" />
        <div className="wrap hero-in">
          <div className="pill"><span className="dot" />内网部署 · 研发闭环自动化</div>
          <h1 className="hero-title">为研发全流程<br />而生的<span className="grad">自动化平台</span></h1>
          <p className="hero-sub">在服务端定义规则，在研发终端自动执行，让 Issue 从采集到交付全程可观测。</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onEnter}>进入控制台</button>
            <a className="btn btn-outline" href="#arch">查看架构</a>
          </div>
          <div className="hero-note">支持 Claude Code · Cursor · Codex · CodeBuddy 多端接入</div>
        </div>
      </header>

      <section className="block" id="arch" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="arch" data-reveal>
            <div className="arch-head">
              <h3>系统架构 · 反向长连接</h3>
              <span>服务端编排 · 客户端执行 · 文档回流</span>
            </div>
            <ArchSvg />
          </div>
        </div>
      </section>

      <section className="block" id="feat" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <div className="sec-tag">核心能力</div>
            <div className="sec-h">从一条 Issue 到一次交付</div>
            <p className="sec-p">采集、判定、分拣、编排、执行、回流——研发流程的每个环节都在同一条可观测的流水线上。</p>
          </div>
          <div className="bento">
            <div className="bcard ba" data-reveal style={{ '--rd': 0 } as React.CSSProperties}>
              <span className="glow" style={{ background: 'rgba(79,70,229,.28)', top: -60, right: -50 }} />
              <div className="bicon b1i"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg></span></div>
              <h4>智能准入与分拣</h4>
              <p>基于服务端知识库自动判定 Issue 是否准入，并识别关联项目与代码仓库，命中即生成执行上下文。</p>
              <div className="bvis"><div className="bvis-in"><VisAdmission /></div></div>
            </div>

            <div className="bcard bb" data-reveal style={{ '--rd': 1 } as React.CSSProperties}>
              <span className="glow" style={{ background: 'rgba(14,116,144,.26)', top: -60, right: -50 }} />
              <div className="bicon b3i"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M9 19v2M15 19v2" /><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" /><path d="M12 7V4" /></svg></span></div>
              <h4>端侧 Coding Agent</h4>
              <p>同一终端可挂载 Claude Code、Cursor、Codex、CodeBuddy 多后端，配置即下发，执行即回传。文档生成同样由端侧 Agent 完成——它需要真正读懂代码。</p>
              <div className="bvis"><div className="bvis-in"><VisAgents /></div></div>
            </div>

            <div className="bcard" data-reveal style={{ '--rd': 2 } as React.CSSProperties}>
              <span className="glow" style={{ background: 'rgba(109,40,217,.26)', bottom: -60, left: -50 }} />
              <div className="bicon b2i"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="7" height="5" rx="1.5" /><rect x="14" y="15" width="7" height="5" rx="1.5" /><path d="M6.5 9v5.5a2 2 0 002 2H14" /></svg></span></div>
              <h4>双轨工作流编排</h4>
              <p>需求与缺陷各自的标准链路可可视化编排，节点按策略自动推进。</p>
              <div className="bvis"><div className="bvis-in"><VisWorkflow /></div></div>
            </div>

            <div className="bcard" data-reveal style={{ '--rd': 3 } as React.CSSProperties}>
              <span className="glow" style={{ background: 'rgba(21,128,61,.24)', bottom: -60, right: -50 }} />
              <div className="bicon b4i"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.8" /></svg></span></div>
              <h4>全链路可观测</h4>
              <p>渲染后的 Prompt、每次调用的模型与费用、客户端连接与作业进度，在服务端一览无余。</p>
              <div className="bvis"><div className="bvis-in"><VisObserve /></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="sec" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-dark" data-reveal>
            <div>
              <h3>代码不出内网，<br />过程全程留痕</h3>
              <p className="sp">服务端只在内网编排，敏感仓库强制走私有化推理；所有 AI 调用记录渲染后的 Prompt 与用量，可审计、可追溯、可回滚。</p>
            </div>
            <div className="slist">
              <div className="sitem">
                <div className="si"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7.5 3v6c0 4.5-3.1 7.9-7.5 9.5C7.6 19.9 4.5 16.5 4.5 12V6z" /><path d="M9 12l2 2 4-4" /></svg></span></div>
                <div><b>mTLS 双向认证</b><span>客户端凭证 + 任务 HMAC 签名，杜绝伪造指令</span></div>
              </div>
              <div className="sitem">
                <div className="si"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2.4" /><path d="M8.5 10V7.5a3.5 3.5 0 017 0V10" /></svg></span></div>
                <div><b>四道安全护栏</b><span>分支隔离 · 测试门禁 · 仅提 MR · 失败自动回滚</span></div>
              </div>
              <div className="sitem">
                <div className="si"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15.5 12v2.5" /></svg></span></div>
                <div><b>RBAC 六角色</b><span>按业务域鉴权，谁能看什么、操作什么一目了然</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

    </SiteChrome>
  )
}
