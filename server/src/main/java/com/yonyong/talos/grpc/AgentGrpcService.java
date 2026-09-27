package com.yonyong.talos.grpc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.entity.ClientEntity;
import com.yonyong.talos.entity.DocEntity;
import com.yonyong.talos.repository.ClientRepository;
import com.yonyong.talos.repository.DocRepository;
import com.yonyong.talos.service.*;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.devh.boot.grpc.server.service.GrpcService;
import org.springframework.beans.factory.annotation.Value;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * 反向长连接服务端：
 * - 客户端主动建立 Connect 流并完成注册
 * - 服务端把该流登记为 ClientSink，后续任务与配置顺流下发
 * - 客户端心跳、任务回执、AI 调用日志经同一条流回传
 */
@Slf4j
@GrpcService
@RequiredArgsConstructor
public class AgentGrpcService extends AgentServiceGrpc.AgentServiceImplBase {

    private final ClientRegistry registry;
    private final ClientRepository clientRepository;
    private final ConfigService configService;
    private final WorkflowService workflowService;
    private final AiLogService aiLogService;
    private final DocRepository docRepository;
    private final ClientLogService clientLog;
    private final AgentReleaseService releaseService;
    private final DispatchService dispatchService;
    private final ProbeService probeService;
    private final AutoStartService autoStartService;

    /** 客户端上线时若版本落后，自动静默升级（可在 application.yml 关闭） */
    @Value("${talos.agent.auto-upgrade:true}")
    private boolean autoUpgrade;

    private final ObjectMapper om = new ObjectMapper();

    @Override
    public StreamObserver<ClientMessage> connect(StreamObserver<ServerMessage> out) {
        return new StreamObserver<>() {
            String clientId;
            /** 本条连接的身份，用于区分同一客户端的旧连接与新连接（见 offline） */
            final Object owner = new Object();
            final ConcurrentLinkedQueue<ServerMessage> queue = new ConcurrentLinkedQueue<>();
            /** 下行出口：首次注册与心跳自愈重建共用同一个，保证始终写回这条流 */
            final StreamObserver<ServerMessage> downstream = out;

            /** 把本连接包装成可下发的 sink */
            private ClientSink sink() {
                return message -> {
                    try {
                        ServerMessage sm = ServerMessage.newBuilder()
                                .setType(String.valueOf(((Map<?, ?>) message).get("type")))
                                .setPayloadJson(om.writeValueAsString(message))
                                .setSignature(String.valueOf(((Map<?, ?>) message).get("signature")))
                                .build();
                        downstream.onNext(sm);
                    } catch (Exception e) {
                        log.error("下发失败", e);
                    }
                };
            }

            @Override
            public void onNext(ClientMessage msg) {
                try {
                    Map<String, Object> payload = msg.getPayloadJson() == null || msg.getPayloadJson().isBlank()
                            ? Map.of()
                            : om.readValue(msg.getPayloadJson(), Map.class);
                    switch (msg.getType()) {
                        case "REGISTER" -> register(payload);
                        case "HEARTBEAT" -> heartbeat(payload);
                        case "TASK_RESULT" -> taskResult(payload);
                        case "CALL_LOG" -> callLog(payload);
                        case "LOG_DATA" -> logData(payload);
                        case "UPGRADE_STATE" -> upgradeState(payload);
                        case "PROBE_RESULT" -> probeService.complete(payload);
                        default -> log.warn("未知消息类型: {}", msg.getType());
                    }
                } catch (Exception e) {
                    log.error("处理客户端消息失败", e);
                }
            }

            @Override
            public void onError(Throwable t) {
                log.warn("连接异常: {} - {}", clientId, t.getMessage());
                offline();
            }

            @Override
            public void onCompleted() {
                log.info("连接关闭: {}", clientId);
                offline();
                out.onCompleted();
            }

            private void offline() {
                if (clientId == null) return;
                // 静默升级是「旧连接关闭 + 新连接注册」，旧连接的回调可能后到。
                // 注销按连接归属判断，避免把刚重启上线的客户端误标为离线。
                if (!registry.unregister(clientId, owner)) return;
                ClientEntity c = clientRepository.findByClientId(clientId);
                if (c != null) {
                    c.setStatus("OFFLINE");
                    clientRepository.save(c);
                }
                clientLog.warn(clientId, "server", "连接关闭，客户端下线");
            }

            /** 注册：登记 sink、更新在线状态，并立即下发一次配置 */
            private void register(Map<String, Object> payload) {
                clientId = String.valueOf(payload.get("clientId"));
                registry.register(clientId, sink(), owner);

                ClientEntity c = clientRepository.findByClientId(clientId);
                if (c == null) {
                    c = new ClientEntity();
                    c.setClientId(clientId);
                }
                c.setStatus("ONLINE");
                c.setLastHeartbeat(LocalDateTime.now());
                c.setIp(String.valueOf(payload.getOrDefault("ip", "")));
                c.setVersion(String.valueOf(payload.getOrDefault("version", "")));
                c.setAgentSummary(String.valueOf(payload.getOrDefault("agents", "")));
                clientRepository.save(c);

                clientLog.ok(clientId, "server", "客户端上线 · " + c.getIp() + " · 版本 " + c.getVersion()
                        + " · 后端 " + c.getAgentSummary());

                // 上线即下发合并后的配置（全局默认 + 本客户端覆盖）。
                // 必须打上 type，否则客户端拿到的报文没有类型标记，会被当作未知消息丢弃。
                Map<String, Object> push = configService.buildPush(clientId);
                push.put("type", "CONFIG_PUSH");
                registry.get(clientId).send(push);
                clientLog.info(clientId, "server", "已下发配置 · Agent " + agentCount(push) + " 个 · Prompt "
                        + promptCount(push) + " 个");
                log.info("客户端注册完成并已下发配置: {}", clientId);

                // 补发离线期间堆积的排队任务（下发失败是静默的，节点会一直停在 waiting）
                int resumed = workflowService.resumeQueued(clientId);
                if (resumed > 0) {
                    clientLog.ok(clientId, "server", "已补发离线期间排队的任务 · " + resumed + " 个节点");
                }

                // 补启离线期间满足自动启动条件但客户端不在线而留下的分拣中 Issue
                int autoStarted = autoStartService.startPendingForClient(clientId);
                if (autoStarted > 0) {
                    clientLog.ok(clientId, "server", "客户端上线，已自动启动 " + autoStarted + " 个待执行工作流");
                }

                maybeAutoUpgrade(clientId, c.getVersion());
            }

            /**
             * 静默升级：客户端版本落后于服务端发布版时，自动下发 UPGRADE 指令。
             * 客户端下载、校验、替换、重启全在后台完成，研发人员无感。
             */
            private void maybeAutoUpgrade(String clientId, String clientVersion) {
                AgentReleaseService.Release release = releaseService.latest();
                if (release == null || !releaseService.needsUpgrade(clientVersion)) return;
                if (!autoUpgrade) {
                    clientLog.info(clientId, "server", "发现新版本 " + release.version() + "（自动升级已关闭，可手工触发）");
                    return;
                }
                clientLog.info(clientId, "server", "发现新版本 " + release.version() + "，自动下发静默升级");
                dispatchService.sendCommand(clientId, UpgradeCommand.build(release));
            }

            private void heartbeat(Map<String, Object> payload) {
                // 心跳是「这条流仍然活着」的最强证据。若注册表里已经没有这条 sink
                // （巡检误删、连接归属竞争等），就据当前连接补登记后再刷新 lastSeen，
                // 否则会出现「心跳一直在、下发一律说离线」且永不自愈的死局。
                if (clientId != null && registry.get(clientId) == null) {
                    registry.register(clientId, sink(), owner);
                    clientLog.warn(clientId, "server", "注册表缺失该连接的 sink，已按心跳自愈重建");
                    log.info("按心跳自愈重建 sink: {}", clientId);
                    // 自愈前下发全部落空，这里顺带把排队任务补上（心跳自愈只在异常时发生，频率可控）
                    int resumed = workflowService.resumeQueued(clientId);
                    if (resumed > 0) {
                        clientLog.ok(clientId, "server", "自愈重建后已补发排队任务 · " + resumed + " 个节点");
                    }
                }
                registry.heartbeat(clientId);
                ClientEntity c = clientRepository.findByClientId(clientId);
                if (c != null) {
                    c.setLastHeartbeat(LocalDateTime.now());
                    c.setStatus("BUSY".equals(payload.get("state")) ? "BUSY" : "ONLINE");
                    clientRepository.save(c);
                }
                // 心跳节流记录，避免每 10 秒刷一条
                clientLog.heartbeat(clientId, payload.get("state") == null ? "" : "状态 " + payload.get("state"));
            }

            /** 任务回执：推进工作流 */
            private void taskResult(Map<String, Object> payload) {
                String instanceCode = String.valueOf(payload.get("instanceCode"));
                int step = Integer.parseInt(String.valueOf(payload.get("step")));
                boolean success = Boolean.parseBoolean(String.valueOf(payload.get("success")));
                String text = String.valueOf(payload.getOrDefault("log", ""));
                workflowService.advance(instanceCode, step, success, text);
                String brief = text == null || text.isBlank() ? "" : " · " + firstLine(text);
                if (success) {
                    clientLog.ok(clientId, "server", "任务回执成功 · " + instanceCode + " step=" + step + brief);
                } else {
                    clientLog.err(clientId, "server", "任务回执失败 · " + instanceCode + " step=" + step + brief);
                }
                log.info("任务回执: {} step={} success={}", instanceCode, step, success);
            }

            /** 客户端日志回传：逐行落入该客户端的日志缓冲 */
            @SuppressWarnings("unchecked")
            private void logData(Map<String, Object> payload) {
                Object lines = payload.get("lines");
                int n = 0;
                if (lines instanceof java.util.List<?> list) {
                    for (Object line : list) {
                        clientLog.record(clientId, "info", "agent", String.valueOf(line));
                        n++;
                    }
                }
                clientLog.info(clientId, "server", "已接收客户端日志 " + n + " 行 · 文件 "
                        + payload.getOrDefault("file", "logs/agent.log") + " · "
                        + payload.getOrDefault("sizeText", "—"));
            }

            /** 升级结果回报：成功/失败都要落到链路事件里，否则升级黑盒 */
            private void upgradeState(Map<String, Object> payload) {
                String stage = String.valueOf(payload.getOrDefault("stage", ""));
                String version = String.valueOf(payload.getOrDefault("version", ""));
                String message = String.valueOf(payload.getOrDefault("message", ""));
                String level = "FAILED".equalsIgnoreCase(stage) ? "err" : "ok";
                clientLog.record(clientId, level, "server",
                        "升级[" + stage + "] → " + version + (message.isBlank() ? "" : " · " + message));
            }

            /** AI 调用日志：含渲染后的最终 Prompt */
            private void callLog(Map<String, Object> payload) {
                String issueCode = String.valueOf(payload.get("issueCode"));
                String node = String.valueOf(payload.get("node"));
                String kind = payload.get("kind") == null ? null : String.valueOf(payload.get("kind"));

                // 机械节点（拉取 Git 等）不调用模型，根本没有模型交互可记。
                // 新版客户端不会上报，旧版客户端（≤1.4.2）会把这类节点当成后端默认值
                // （codebuddy）记一条 token=0、输出为空、Prompt 是兜底文案的假调用 ——
                // 在这里按节点名回查类型挡住，别让它污染 AI 调用日志与耗时统计。
                if (workflowService.isMechanicalNodeCall(issueCode, node, kind)) {
                    clientLog.warn(clientId, "server", "已丢弃机械节点的 AI 调用上报 · 节点 " + node
                            + " · Issue " + issueCode + "（该节点类型不调用模型）");
                    log.warn("丢弃机械节点的 AI 调用上报: issue={} node={} kind={}", issueCode, node, kind);
                    return;
                }

                Long token = payload.get("tokenUsed") == null ? 0L
                        : Long.parseLong(String.valueOf(payload.get("tokenUsed")));
                Long latency = payload.get("latencyMs") == null ? 0L
                        : Long.parseLong(String.valueOf(payload.get("latencyMs")));
                BigDecimal cost = payload.get("cost") == null ? BigDecimal.ZERO
                        : new BigDecimal(String.valueOf(payload.get("cost")));

                AiCallLogEntity e = aiLogService.record(
                        issueCode,
                        node,
                        String.valueOf(payload.get("backend")),
                        String.valueOf(payload.get("model")),
                        String.valueOf(payload.get("renderedPrompt")),
                        Boolean.parseBoolean(String.valueOf(payload.get("missingVars"))),
                        latency, token, cost, clientId);
                clientLog.info(clientId, "server", "AI 调用 · " + e.getBackend() + "/" + e.getModel()
                        + " · 节点 " + e.getNode() + " · 耗时 " + (latency / 1000.0) + "s"
                        + (Boolean.TRUE.equals(e.getMissingVars()) ? " · 存在缺失变量" : ""));
                log.info("AI 调用日志已记录: id={}", e.getId());
            }
        };
    }

    @SuppressWarnings("unchecked")
    private static int agentCount(Map<String, Object> push) {
        Object v = push.get("agents");
        return v instanceof java.util.List<?> l ? l.size() : 0;
    }

    @SuppressWarnings("unchecked")
    private static int promptCount(Map<String, Object> push) {
        Object v = push.get("prompts");
        return v instanceof java.util.List<?> l ? l.size() : 0;
    }

    private static String firstLine(String s) {
        String t = s.strip();
        int nl = t.indexOf('\n');
        t = nl > 0 ? t.substring(0, nl) : t;
        return t.length() > 160 ? t.substring(0, 160) + "…" : t;
    }

    /** 过程文档回传 */
    @Override
    public void uploadArtifact(ArtifactRequest req, StreamObserver<ArtifactResponse> out) {
        try {
            DocEntity d = new DocEntity();
            d.setClientId(req.getClientId());
            d.setIssueCode(req.getIssueCode());
            d.setName(req.getName());
            d.setKind(req.getKind());
            d.setContent(req.getContent());
            d.setSizeText(req.getSizeText());
            d.setSource("客户端回传");
            docRepository.save(d);

            out.onNext(ArtifactResponse.newBuilder().setOk(true).setMessage("已归档").build());
            out.onCompleted();
        } catch (Exception e) {
            log.error("文档回传失败", e);
            out.onNext(ArtifactResponse.newBuilder().setOk(false).setMessage(e.getMessage()).build());
            out.onCompleted();
        }
    }
}
