package com.yonyong.talos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 客户端运行日志（按 clientId 分桶的内存环形缓冲）。
 *
 * 两个来源：
 * - source=server：服务端观测到的链路事件（上线、配置下发、任务下发、回执、离线…）
 * - source=agent ：客户端经 PULL_LOG 指令回传的 logs/agent.log 尾部
 *
 * 只保留最近 CAPACITY 条，进程重启即清空 —— 这是「看当前这条连接发生了什么」的
 * 运维视图，不是审计存储；需要长期留存的 AI 调用记录走 t_ai_call_log。
 */
@Slf4j
@Service
public class ClientLogService {

    /** 每个客户端保留的最大条数 */
    private static final int CAPACITY = 800;
    /** 心跳日志节流：同一客户端最短记录间隔（秒），避免刷屏 */
    private static final long HEARTBEAT_LOG_INTERVAL_SEC = 300;

    public record Entry(String ts, String level, String source, String message) { }

    private final Map<String, Deque<Entry>> buffers = new ConcurrentHashMap<>();
    private final Map<String, Long> lastHeartbeatLogged = new ConcurrentHashMap<>();

    public void record(String clientId, String level, String source, String message) {
        if (clientId == null || clientId.isBlank() || "null".equals(clientId)) return;
        Deque<Entry> q = buffers.computeIfAbsent(clientId, k -> new ConcurrentLinkedDeque<>());
        q.addLast(new Entry(LocalDateTime.now().toString(), level, source, clip(message)));
        while (q.size() > CAPACITY) q.pollFirst();
    }

    public void ok(String clientId, String source, String message) { record(clientId, "ok", source, message); }
    public void info(String clientId, String source, String message) { record(clientId, "info", source, message); }
    public void warn(String clientId, String source, String message) { record(clientId, "warn", source, message); }
    public void err(String clientId, String source, String message) { record(clientId, "err", source, message); }

    /** 心跳日志节流：默认 5 分钟最多记一条，链路静默时也能看出「还活着」 */
    public void heartbeat(String clientId, String detail) {
        long now = System.currentTimeMillis();
        Long prev = lastHeartbeatLogged.get(clientId);
        if (prev != null && now - prev < HEARTBEAT_LOG_INTERVAL_SEC * 1000L) return;
        lastHeartbeatLogged.put(clientId, now);
        info(clientId, "server", "心跳正常" + (detail == null || detail.isBlank() ? "" : " · " + detail));
    }

    /** 最近 limit 条，按时间正序返回，便于前端直接顺序渲染终端 */
    public List<Entry> tail(String clientId, int limit) {
        Deque<Entry> q = buffers.get(clientId);
        if (q == null || q.isEmpty()) return List.of();
        List<Entry> all = new ArrayList<>(q);
        int from = Math.max(0, all.size() - Math.max(1, limit));
        return new ArrayList<>(all.subList(from, all.size()));
    }

    /** 按来源过滤（server / agent / all） */
    public List<Entry> tail(String clientId, int limit, String source) {
        List<Entry> all = tail(clientId, CAPACITY);
        if (source == null || source.isBlank() || "all".equalsIgnoreCase(source)) {
            int from = Math.max(0, all.size() - Math.max(1, limit));
            return new ArrayList<>(all.subList(from, all.size()));
        }
        List<Entry> filtered = all.stream().filter(e -> source.equalsIgnoreCase(e.source())).toList();
        int from = Math.max(0, filtered.size() - Math.max(1, limit));
        return new ArrayList<>(filtered.subList(from, filtered.size()));
    }

    public int size(String clientId) {
        Deque<Entry> q = buffers.get(clientId);
        return q == null ? 0 : q.size();
    }

    public void clear(String clientId) {
        buffers.remove(clientId);
        lastHeartbeatLogged.remove(clientId);
    }

    private static String clip(String s) {
        if (s == null) return "";
        String t = s.strip();
        return t.length() > 2000 ? t.substring(0, 2000) + " …（已截断）" : t;
    }
}
