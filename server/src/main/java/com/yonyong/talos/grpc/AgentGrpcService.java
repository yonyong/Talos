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

    private final ObjectMapper om = new ObjectMapper();

    @Override
    public StreamObserver<ClientMessage> connect(StreamObserver<ServerMessage> out) {
        return new StreamObserver<>() {
            String clientId;
            final ConcurrentLinkedQueue<ServerMessage> queue = new ConcurrentLinkedQueue<>();

            @Override
            public void onNext(ClientMessage msg) {
                try {
                    Map<String, Object> payload = msg.getPayloadJson() == null || msg.getPayloadJson().isBlank()
                            ? Map.of()
                            : om.readValue(msg.getPayloadJson(), Map.class);
                    switch (msg.getType()) {
                        case "REGISTER" -> register(payload, out);
                        case "HEARTBEAT" -> heartbeat(payload);
                        case "TASK_RESULT" -> taskResult(payload);
                        case "CALL_LOG" -> callLog(payload);
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
                if (clientId != null) {
                    registry.unregister(clientId);
                    clientRepository.findByClientId(clientId);
                    ClientEntity c = clientRepository.findByClientId(clientId);
                    if (c != null) {
                        c.setStatus("OFFLINE");
                        clientRepository.save(c);
                    }
                }
            }

            /** 注册：登记 sink、更新在线状态，并立即下发一次配置 */
            private void register(Map<String, Object> payload, StreamObserver<ServerMessage> out) {
                clientId = String.valueOf(payload.get("clientId"));
                registry.register(clientId, message -> {
                    try {
                        ServerMessage sm = ServerMessage.newBuilder()
                                .setType(String.valueOf(((Map<?, ?>) message).get("type")))
                                .setPayloadJson(om.writeValueAsString(message))
                                .setSignature(String.valueOf(((Map<?, ?>) message).get("signature")))
                                .build();
                        out.onNext(sm);
                    } catch (Exception e) {
                        log.error("下发失败", e);
                    }
                });

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

                // 上线即下发合并后的配置（全局默认 + 本客户端覆盖）
                registry.get(clientId).send(configService.buildPush(clientId));
                log.info("客户端注册完成并已下发配置: {}", clientId);
            }

            private void heartbeat(Map<String, Object> payload) {
                registry.heartbeat(clientId);
                ClientEntity c = clientRepository.findByClientId(clientId);
                if (c != null) {
                    c.setLastHeartbeat(LocalDateTime.now());
                    c.setStatus("BUSY".equals(payload.get("state")) ? "BUSY" : "ONLINE");
                    clientRepository.save(c);
                }
            }

            /** 任务回执：推进工作流 */
            private void taskResult(Map<String, Object> payload) {
                String instanceCode = String.valueOf(payload.get("instanceCode"));
                int step = Integer.parseInt(String.valueOf(payload.get("step")));
                boolean success = Boolean.parseBoolean(String.valueOf(payload.get("success")));
                String text = String.valueOf(payload.getOrDefault("log", ""));
                workflowService.advance(instanceCode, step, success, text);
                log.info("任务回执: {} step={} success={}", instanceCode, step, success);
            }

            /** AI 调用日志：含渲染后的最终 Prompt */
            private void callLog(Map<String, Object> payload) {
                Long token = payload.get("tokenUsed") == null ? 0L
                        : Long.parseLong(String.valueOf(payload.get("tokenUsed")));
                Long latency = payload.get("latencyMs") == null ? 0L
                        : Long.parseLong(String.valueOf(payload.get("latencyMs")));
                BigDecimal cost = payload.get("cost") == null ? BigDecimal.ZERO
                        : new BigDecimal(String.valueOf(payload.get("cost")));

                AiCallLogEntity e = aiLogService.record(
                        String.valueOf(payload.get("issueCode")),
                        String.valueOf(payload.get("node")),
                        String.valueOf(payload.get("backend")),
                        String.valueOf(payload.get("model")),
                        String.valueOf(payload.get("renderedPrompt")),
                        Boolean.parseBoolean(String.valueOf(payload.get("missingVars"))),
                        latency, token, cost, clientId);
                log.info("AI 调用日志已记录: id={}", e.getId());
            }
        };
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
