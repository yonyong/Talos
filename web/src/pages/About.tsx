import SiteChrome from '../components/SiteChrome'

/** 官网「关于 Talos」 */
export default function About() {
  return (
    <SiteChrome active="about">
      <section className="block site-page">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <div className="sec-head">
            <div className="sec-tag">关于</div>
            <div className="sec-h">关于 Talos</div>
            <p className="sec-p">研发周期全自动流程平台：在服务端定义规则，在研发终端自动执行。</p>
          </div>

          <div className="about-prose">
            <p>
              Talos 把 Issue 采集、准入判定、智能分拣与端侧 Coding Agent 编排成一条可观测的流水线。
              服务端只做编排与配置下发；真正读代码、改代码、生成文档的工作发生在研发终端本地。
            </p>
            <p>
              终端通常位于 NAT 之后，因此客户端主动与服务端建立 gRPC 双向长连接。
              敏感仓库可强制走私有化推理，过程全程留痕，可审计、可回滚。
            </p>
            <ul>
              <li>支持 Claude Code、Cursor、Codex、CodeBuddy 等多后端接入</li>
              <li>需求与缺陷双轨工作流，节点按策略自动推进</li>
              <li>mTLS / 任务签名 / RBAC，代码与数据默认不出内网</li>
            </ul>
            <p className="about-links">
              <a href="#/" onClick={(e) => { e.preventDefault(); window.location.hash = '#/'; setTimeout(() => document.getElementById('arch')?.scrollIntoView({ behavior: 'smooth' }), 80) }}>查看架构 →</a>
              <a href="#/contact">联系我们 →</a>
              <a href="#/docs">文档中心 →</a>
            </p>
          </div>
        </div>
      </section>
    </SiteChrome>
  )
}
