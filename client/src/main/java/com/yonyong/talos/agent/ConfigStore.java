package com.yonyong.talos.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.util.*;

/**
 * 配置仓库：保存服务端下发的 Coding Agent 配置与 Prompt 模板。
 * 所有 Prompt 均来自服务端配置，客户端只做变量注入。
 */
@Slf4j
public class ConfigStore {

    private final ObjectMapper om = new ObjectMapper();

    @Getter
    private final Map<String, Map<String, Object>> agents = new LinkedHashMap<>();
    private final Map<String, String> prompts = new LinkedHashMap<>();
    private final Map<String, String> promptMeta = new LinkedHashMap<>();

    /** 应用服务端 ConfigPush */
    @SuppressWarnings("unchecked")
    public void applyPush(Map<String, Object> push) {
        Object agentsObj = push.get("agents");
        if (agentsObj instanceof List<?> list) {
            for (Object o : list) {
                Map<String, Object> a = (Map<String, Object>) o;
                agents.put(String.valueOf(a.get("backend")), a);
            }
        }
        Object promptsObj = push.get("prompts");
        if (promptsObj instanceof List<?> list) {
            for (Object o : list) {
                Map<String, Object> p = (Map<String, Object>) o;
                String name = String.valueOf(p.get("name"));
                prompts.put(name, String.valueOf(p.get("content")));
                promptMeta.put(name, String.valueOf(p.get("backend")) + " | " + String.valueOf(p.get("scene")));
            }
        }
        log.info("配置已应用：Agent {} 个 · Prompt {} 个", agents.size(), prompts.size());
    }

    public String prompt(String name) { return prompts.get(name); }

    public Map<String, String> promptMeta() { return promptMeta; }

    /** 选择后端：优先 CodeBuddy（私有化），其次配置启用的第一个 */
    public String pickBackend(String configured) {
        if (configured != null && !"—".equals(configured) && agents.containsKey(configured)) return configured;
        if (agents.containsKey("codebuddy")) return "codebuddy";
        return agents.keySet().stream().findFirst().orElse("codebuddy");
    }

    public String modelOf(String backend) {
        Map<String, Object> a = agents.get(backend);
        return a == null ? "unknown" : String.valueOf(a.getOrDefault("model", "unknown"));
    }
}
