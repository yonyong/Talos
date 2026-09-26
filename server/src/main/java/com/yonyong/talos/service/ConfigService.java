package com.yonyong.talos.service;

import com.yonyong.talos.entity.AgentConfigEntity;
import com.yonyong.talos.entity.PromptTemplateEntity;
import com.yonyong.talos.repository.AgentConfigRepository;
import com.yonyong.talos.repository.PromptTemplateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 配置管理：服务端统管，按客户端差异化覆盖。
 * 合并顺序：GLOBAL 默认 → 该 clientId 的覆盖项。
 */
@Service
@RequiredArgsConstructor
public class ConfigService {

    public static final String GLOBAL = "GLOBAL";

    private final AgentConfigRepository agentConfigRepository;
    private final PromptTemplateRepository promptTemplateRepository;

    /** 合并后的 Agent 配置（供下发与页面展示） */
    public List<AgentConfigEntity> merged(String clientId) {
        Map<String, AgentConfigEntity> map = new LinkedHashMap<>();
        agentConfigRepository.findByScope(GLOBAL).forEach(c -> map.put(c.getBackend(), c));
        if (clientId != null && !GLOBAL.equals(clientId)) {
            agentConfigRepository.findByScope(clientId).forEach(c -> map.put(c.getBackend(), c));
        }
        return new ArrayList<>(map.values());
    }

    /** 生成下发报文 */
    public Map<String, Object> buildPush(String clientId) {
        Map<String, Object> push = new LinkedHashMap<>();
        push.put("scope", clientId == null ? GLOBAL : clientId);
        push.put("agents", merged(clientId).stream().map(a -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("backend", a.getBackend());
            m.put("model", a.getModel());
            m.put("enabled", Boolean.TRUE.equals(a.getEnabled()));
            m.put("tokenLimit", a.getTokenLimit());
            m.put("privateOnly", Boolean.TRUE.equals(a.getPrivateOnly()));
            return m;
        }).collect(Collectors.toList()));

        List<PromptTemplateEntity> tpls = promptTemplateRepository.findAll();
        push.put("prompts", tpls.stream().map(t -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", t.getName());
            m.put("scene", t.getScene());
            m.put("backend", t.getBackend());
            m.put("variables", t.getVariables());
            m.put("content", t.getContent());
            return m;
        }).collect(Collectors.toList()));
        return push;
    }

    public AgentConfigEntity save(AgentConfigEntity cfg) {
        cfg.setUpdatedAt(java.time.LocalDateTime.now());
        return agentConfigRepository.save(cfg);
    }
}
