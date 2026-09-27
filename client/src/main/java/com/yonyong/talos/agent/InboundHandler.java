package com.yonyong.talos.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.grpc.ServerMessage;
import io.grpc.ManagedChannel;
import lombok.extern.slf4j.Slf4j;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * 下行消息分发：服务端经反向长连接推送的 CONFIG_PUSH / TASK_DISPATCH / COMMAND。
 *
 * COMMAND 覆盖：RECONNECT（重建连接）、PULL_LOG（回传本地日志尾部）、
 * UPGRADE（静默升级）、CANCEL_TASK、RELOAD_CONFIG。
 */
@Slf4j
public class InboundHandler {

    private final ObjectMapper om = new ObjectMapper();
    private final AgentConfig config;
    private final ConfigStore configStore;
    private final TaskExecutor taskExecutor;
    private final AgentLogTail logTail;
    private final Upgrader upgrader;
    private final ProbeExecutor probeExecutor;
    private final BiConsumer<String, Map<String, Object>> sender;
    private final Runnable reconnector;

    public InboundHandler(AgentConfig config,
                          ConfigStore configStore,
                          BiConsumer<String, Map<String, Object>> sender,
                          Supplier<ManagedChannel> channelProvider,
                          Runnable reconnector,
                          Runnable stopDaemon) {
        this.config = config;
        this.configStore = configStore;
        this.sender = sender;
        this.reconnector = reconnector;
        this.taskExecutor = new TaskExecutor(config, configStore, sender, channelProvider);
        this.logTail = new AgentLogTail(config);
        this.upgrader = new Upgrader(config, sender, stopDaemon);
        this.probeExecutor = new ProbeExecutor(configStore, sender);
    }

    @SuppressWarnings("unchecked")
    public void handle(ServerMessage msg) {
        Map<String, Object> payload = parse(msg.getPayloadJson());
        String type = msg.getType();
        log.debug("收到下行消息: {} payload={}", type, payload);

        switch (type) {
            case "CONFIG_PUSH" -> configStore.applyPush(payload);
            case "TASK_DISPATCH" -> dispatch(payload, msg);
            case "COMMAND" -> handleCommand(payload, msg);
            case "PROBE_REQ" -> probeExecutor.submit(payload);
            default -> log.warn("未知下行消息类型: {}", type);
        }
    }

    /** 任务下发：校验服务端 HMAC 签名后再交给执行器 */
    private void dispatch(Map<String, Object> payload, ServerMessage msg) {
        if (SignatureVerifier.verify(msg.getPayloadJson(), msg.getSignature(), config.signSecret())) {
            taskExecutor.submit(payload);
            return;
        }
        log.error("任务签名校验失败，已拒绝执行: taskId={}", payload.get("taskId"));
        reject(payload);
    }

    /** 拒绝执行时也要回执，避免服务端任务悬在「已下发」 */
    private void reject(Map<String, Object> payload) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("instanceCode", payload.get("instanceCode"));
        r.put("step", payload.get("step"));
        r.put("success", false);
        r.put("log", "任务签名校验失败，客户端已拒绝执行");
        taskExecutor.rejectTask(r);
    }

    /** 服务端指令：重连 / 拉日志 / 静默升级 / 取消任务 / 重载配置 */
    private void handleCommand(Map<String, Object> payload, ServerMessage msg) {
        String cmd = String.valueOf(payload.getOrDefault("command", payload.get("type")));
        switch (cmd) {
            case "RELOAD_CONFIG" -> log.info("服务端要求重载配置，等待下一次 CONFIG_PUSH");
            case "CANCEL_TASK" -> taskExecutor.cancel(String.valueOf(payload.get("taskId")));
            case "RECONNECT" -> reconnect();
            case "PULL_LOG" -> pullLog(intOf(payload.get("lines"), 200));
            case "UPGRADE" -> requestUpgrade(payload, msg);
            default -> log.info("收到未处理指令: {}", cmd);
        }
    }

    /** 服务端要求重建连接：断开当前流，主循环会按退避策略重新建连 */
    private void reconnect() {
        log.info("服务端要求重建连接，正在断开当前流");
        reconnector.run();
    }

    /** 回传本地 logs/agent.log 尾部；读盘与序列化放到独立线程，不阻塞 gRPC 流 */
    private void pullLog(int lines) {
        Thread t = new Thread(() -> {
            try {
                Map<String, Object> data = logTail.tail(lines);
                sender.accept("LOG_DATA", data);
            } catch (Exception e) {
                log.warn("回传本地日志失败: {}", e.getMessage());
            }
        }, "talos-pull-log");
        t.setDaemon(true);
        t.start();
    }

    /** 静默升级：升级包地址同样校验签名，防止被伪造的地址替换本地 jar */
    private void requestUpgrade(Map<String, Object> payload, ServerMessage msg) {
        if (!SignatureVerifier.verify(msg.getPayloadJson(), msg.getSignature(), config.signSecret())) {
            log.error("升级指令签名校验失败，已拒绝执行");
            Map<String, Object> state = new LinkedHashMap<>();
            state.put("stage", "FAILED");
            state.put("version", String.valueOf(payload.get("version")));
            state.put("message", "升级指令签名校验失败，客户端已拒绝执行");
            sender.accept("UPGRADE_STATE", state);
            return;
        }
        log.info("收到静默升级指令 → {}，开始后台下载", payload.get("version"));
        upgrader.applyAsync(payload);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return om.readValue(json, Map.class);
        } catch (Exception e) {
            log.warn("下行消息解析失败: {}", e.getMessage());
            return Map.of();
        }
    }

    private static int intOf(Object o, int fallback) {
        if (o == null) return fallback;
        try {
            return (int) Double.parseDouble(String.valueOf(o));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
