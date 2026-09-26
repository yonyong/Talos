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

    private String branchOf(IssueEntity issue) {
        return (issue.getType() == null ? "req" : issue.getType().toLowerCase()) + "/" + issue.getCode();
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
