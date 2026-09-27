package com.yonyong.talos.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.entity.TaskNodeEntity;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 任务下发：把节点任务通过反向长连接推给目标客户端。
 * 每条指令带 HMAC 签名，客户端校验来源，防止伪造。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DispatchService {

    private final ClientRegistry registry;
    private final ClientLogService clientLog;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${talos.security.task-sign-secret:talos-dev-secret}")
    private String signSecret;

    /** 下发节点任务；客户端离线时返回 false，任务保持排队 */
    public boolean dispatch(TaskNodeEntity node, IssueEntity issue, String clientId) {
        if (clientId == null || !registry.isOnline(clientId)) {
            log.warn("客户端离线，任务排队: client={} node={}", clientId, node.getName());
            return false;
        }
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("type", "TASK_DISPATCH");
        task.put("taskId", node.getId());
        task.put("instanceCode", node.getInstanceCode());
        task.put("step", node.getStep());
        task.put("node", node.getName());
        task.put("kind", node.getKind());
        task.put("backend", node.getBackend());
        task.put("promptTemplate", node.getPromptTemplate());
        task.put("issueCode", issue.getCode());
        task.put("issueTitle", issue.getTitle());
        task.put("repoUrl", issue.getRepoUrl());
        task.put("branch", branchOf(issue));
        task.put("issuedAt", LocalDateTime.now().toString());

        String payload;
        try {
            payload = objectMapper.writeValueAsString(task);
        } catch (Exception e) {
            log.error("任务序列化失败", e);
            return false;
        }
        task.put("signature", hmac(payload));

        ClientSink sink = registry.get(clientId);
        if (sink == null) return false;
        sink.send(task);
        node.setStatus("dispatched");
        clientLog.info(clientId, "server", "下发任务 · " + node.getName() + " · 后端 " + node.getBackend()
                + " · Issue " + issue.getCode());
        log.info("已下发任务: {} → {}", node.getName(), clientId);
        return true;
    }

    /** 下发配置（ConfigPush） */
    public boolean pushConfig(String clientId, Map<String, Object> config) {
        ClientSink sink = registry.get(clientId);
        if (sink == null) return false;
        Map<String, Object> msg = new LinkedHashMap<>(config);
        msg.put("type", "CONFIG_PUSH");
        msg.put("issuedAt", LocalDateTime.now().toString());
        sink.send(msg);
        return true;
    }

    /**
     * 下发运维/升级指令（COMMAND）。
     * 与任务下发同样带 HMAC 签名，客户端可校验来源，防止伪造升级包地址。
     */
    public boolean sendCommand(String clientId, Map<String, Object> command) {
        ClientSink sink = registry.get(clientId);
        if (sink == null) return false;
        Map<String, Object> msg = new LinkedHashMap<>(command);
        msg.put("type", "COMMAND");
        msg.put("issuedAt", LocalDateTime.now().toString());
        try {
            msg.put("signature", hmac(objectMapper.writeValueAsString(msg)));
        } catch (Exception e) {
            log.error("指令序列化失败", e);
            return false;
        }
        sink.send(msg);
        return true;
    }

    private String branchOf(IssueEntity issue) {
        // 分拣时已按仓库的 branchPrefix 算好工作分支（如 feature/req-2251）并快照在 issue.branch 上，
        // 下发必须沿用同一个值。这里原来自己拼 type/code（req/REQ-2251），既忽略 branchPrefix
        // 又不转小写，客户端切出来的分支和 Issue 详情里显示的分支对不上。
        if (issue.getBranch() != null && !issue.getBranch().isBlank()) return issue.getBranch();
        return (issue.getType() == null ? "req" : issue.getType().toLowerCase()) + "/" + issue.getCode().toLowerCase();
    }

    private String hmac(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            log.error("签名失败", e);
            return "";
        }
    }
}
