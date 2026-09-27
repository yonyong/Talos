package com.yonyong.talos.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 探测（Probe）：经 gRPC 双向流把探测指令下发给客户端，客户端在本机执行后回 PROBE_RESULT。
 *
 * 为什么必须这样设计：客户端在 NAT 后，服务端没有任何入站通道，
 * 「测试 Coding Agent / Git / 工具链」只能在客户端本机执行 —— 唯一途径就是
 * 借客户端已建立的下行流发 PROBE_REQ，服务端挂起一个 Future 等回执。
 * fail-safe：离线直接抛错；超时返回明确失败原因，绝不假装成功。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProbeService {

    /** 回执等待上限：CLI --version 类探测几秒内完成，30s 足够覆盖网络抖动 */
    private static final long DEFAULT_TIMEOUT_MS = 30_000;

    private final ClientRegistry registry;

    private final Map<String, CompletableFuture<Map<String, Object>>> pending = new ConcurrentHashMap<>();

    /**
     * 向客户端发探测并同步等回执。
     *
     * @param params 探测参数（kind + 各类型自己的字段），probeId / type / issuedAt 由这里补
     * @return 客户端回执（ok / output / message…）；超时返回 ok=false 的说明性结果
     */
    public Map<String, Object> probe(String clientId, Map<String, Object> params) {
        if (clientId == null || clientId.isBlank() || "null".equals(clientId)) {
            throw new IllegalArgumentException("该用户未绑定客户端，无法测试。请先在「用户管理」里为该工号绑定客户端。");
        }
        ClientSink sink = registry.get(clientId);
        if (sink == null || !registry.isOnline(clientId)) {
            throw new IllegalStateException("客户端 " + clientId + " 离线，无法测试。请先在本机启动客户端并确认控制台显示在线。");
        }

        String probeId = UUID.randomUUID().toString();
        CompletableFuture<Map<String, Object>> future = new CompletableFuture<>();
        pending.put(probeId, future);

        Map<String, Object> msg = new LinkedHashMap<>(params);
        msg.put("type", "PROBE_REQ");
        msg.put("probeId", probeId);
        msg.put("issuedAt", LocalDateTime.now().toString());
        sink.send(msg);
        log.info("已下发探测: {} → {} kind={}", probeId, clientId, params.get("kind"));

        try {
            return future.get(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            return Map.of("ok", false,
                    "message", "客户端未在 30s 内回执：可能客户端版本过旧（不支持探测）或已掉线，请升级客户端后重试");
        } catch (Exception e) {
            return Map.of("ok", false, "message", "探测等待失败: " + e.getMessage());
        } finally {
            pending.remove(probeId);
        }
    }

    /** 客户端 PROBE_RESULT 回执入口；不匹配的 probeId 静默丢弃（已超时移除） */
    public void complete(Map<String, Object> payload) {
        String probeId = String.valueOf(payload.get("probeId"));
        CompletableFuture<Map<String, Object>> f = pending.remove(probeId);
        if (f == null) {
            log.warn("探测回执无等待者（已超时）: {}", probeId);
            return;
        }
        f.complete(payload);
    }
}
