package com.yonyong.talos.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.util.*;

/**
 * 配置仓库：保存服务端下发的 Coding Agent 配置与 Prompt 模板。
 *
 * 所有 Prompt 均来自服务端配置，客户端只做变量注入。
 * Agent 配置采用「本地 agent.yml 兜底 + 服务端下发覆盖」的合并策略：
 * 服务端在「Coding Agent」页配置的 execPath / argsTemplate / workDir / envVars 优先生效，
 * 未配置（null）的字段沿用客户端本地值。
 */
@Slf4j
public class ConfigStore {

    private final ObjectMapper om = new ObjectMapper();

    /** 服务端下发的 Agent 配置，key = backend */
    @Getter
    private final Map<String, Map<String, Object>> agents = new LinkedHashMap<>();

    /** 客户端本地 agent.yml 的 Agent 配置，key = backend，作为兜底 */
    private final Map<String, Map<String, Object>> localAgents = new LinkedHashMap<>();

    private final Map<String, String> prompts = new LinkedHashMap<>();
    private final Map<String, String> promptMeta = new LinkedHashMap<>();

    /** 服务端下发的 Git 凭据（来自绑定用户的「设置面板」），token/user/email */
    @Getter
    private final Map<String, String> git = new LinkedHashMap<>();

    /** 服务端下发的工具链（workDir / mavenHome），来自绑定用户的个人设置 */
    @Getter
    private final Map<String, String> toolchain = new LinkedHashMap<>();

    /** 个人 Agent 优先级顺序（拖拽排序结果），pickBackend 按序取第一个可用的 */
    @Getter
    private volatile List<String> preferredOrder = List.of();

    /** 载入本地兜底配置（来自 agent.yml） */
    public void setLocalAgents(List<Map<String, Object>> list) {
        for (Map<String, Object> a : list) {
            Object backend = a.get("backend");
            if (backend != null) localAgents.put(String.valueOf(backend), a);
        }
        log.info("本地 Agent 兜底配置已载入：{} 个", localAgents.size());
    }

    /** 应用服务端 ConfigPush */
    @SuppressWarnings("unchecked")
    public void applyPush(Map<String, Object> push) {
        Object agentsObj = push.get("agents");
        if (agentsObj instanceof List<?> list) {
            for (Object o : list) {
                Map<String, Object> a = (Map<String, Object>) o;
                Object backend = a.get("backend");
                if (backend != null) agents.put(String.valueOf(backend), a);
            }
        }
        Object promptsObj = push.get("prompts");
        if (promptsObj instanceof List<?> list) {
            for (Object o : list) {
                Map<String, Object> p = (Map<String, Object>) o;
                Object name = p.get("name");
                if (name == null) continue;
                prompts.put(String.valueOf(name), String.valueOf(p.get("content")));
                promptMeta.put(String.valueOf(name),
                        String.valueOf(p.get("backend")) + " | " + String.valueOf(p.get("scene")));
            }
        }
        Object gitObj = push.get("git");
        if (gitObj instanceof Map<?, ?> g) {
            git.clear();
            for (Map.Entry<?, ?> e : g.entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    git.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        Object toolchainObj = push.get("toolchain");
        if (toolchainObj instanceof Map<?, ?> tc) {
            toolchain.clear();
            for (Map.Entry<?, ?> e : tc.entrySet()) {
                if (e.getKey() != null && e.getValue() != null) {
                    toolchain.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        Object orderObj = push.get("personalOrder");
        if (orderObj instanceof List<?> order) {
            preferredOrder = order.stream().map(String::valueOf).toList();
        } else {
            preferredOrder = List.of();
        }
        log.info("服务端配置已应用：Agent {} 个 · Prompt {} 个 · Git凭据 {} · 工具链 {}",
                agents.size(), prompts.size(),
                git.containsKey("token") ? "已配置" : "未配置",
                toolchain.isEmpty() ? "未配置" : toolchain.keySet());
    }

    /**
     * 合并后的生效配置：本地兜底 → 服务端覆盖。
     * 服务端字段为 null 时不覆盖本地值（前端未填 ≠ 客户端不配置）。
     */
    public Map<String, Object> effective(String backend) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> local = localAgents.get(backend);
        if (local != null) m.putAll(local);
        Map<String, Object> remote = agents.get(backend);
        if (remote != null) {
            remote.forEach((k, v) -> {
                if (v != null) m.put(k, v);
            });
        }
        return m.isEmpty() ? null : m;
    }

    public Set<String> backends() {
        Set<String> all = new LinkedHashSet<>(localAgents.keySet());
        all.addAll(agents.keySet());
        return all;
    }

    public String prompt(String name) { return prompts.get(name); }

    public Map<String, String> promptMeta() { return promptMeta; }

    /**
     * 选择后端，优先级：任务/服务端显式指定 > 个人偏好顺序（拖拽）> 私有化兜底。
     * 任务指定最优先——敏感业务「强制走私有化」靠它落地，个人偏好不能绕过；
     * 个人偏好只在服务端未指定（占位符「—」/空）时生效，且选中前提是该后端未被停用。
     */
    public String pickBackend(String configured) {
        if (isSelectable(configured)) return configured;
        if (configured != null && !configured.isBlank() && !"null".equals(configured) && !"—".equals(configured)) {
            log.warn("任务指定的后端 {} 不可用（未下发或已停用），按个人偏好回退", configured);
        }
        for (String pref : preferredOrder) {
            if (isSelectable(pref)) return pref;
        }
        if (isSelectable("codebuddy")) return "codebuddy";
        return backends().stream().filter(this::isSelectable).findFirst().orElse("codebuddy");
    }

    /** 可选中：非占位符、配置存在，且未被管理端/本地 agent.yml 停用 */
    private boolean isSelectable(String backend) {
        if (backend == null || backend.isBlank() || "null".equals(backend) || "—".equals(backend)) return false;
        Map<String, Object> a = effective(backend);
        return a != null && !Boolean.FALSE.equals(a.get("enabled"));
    }

    public String modelOf(String backend) {
        Map<String, Object> a = effective(backend);
        return a == null ? "unknown" : String.valueOf(a.getOrDefault("model", "unknown"));
    }
}
