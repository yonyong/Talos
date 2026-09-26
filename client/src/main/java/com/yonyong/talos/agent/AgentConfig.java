package com.yonyong.talos.agent;

import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/** 客户端配置：conf/agent.yml */
public class AgentConfig {

    private final Map<String, Object> root;

    @SuppressWarnings("unchecked")
    public AgentConfig(Path file) throws Exception {
        if (!Files.exists(file)) throw new IllegalStateException("缺少配置文件: " + file);
        try (InputStream in = Files.newInputStream(file)) {
            this.root = new Yaml().load(in);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> section(String key) {
        Object o = root.get(key);
        return o instanceof Map ? (Map<String, Object>) o : Map.of();
    }

    public String serverAddr() { return String.valueOf(section("server").getOrDefault("addr", "127.0.0.1")); }
    public int serverPort() { return Integer.parseInt(String.valueOf(section("server").getOrDefault("port", 9443))); }
    public String clientId() { return String.valueOf(section("client").getOrDefault("id", "unknown-client")); }
    public String token() { return String.valueOf(section("client").getOrDefault("token", "")); }
    public String workspace() { return String.valueOf(section("client").getOrDefault("workspace", ".")); }
    public int heartbeatSeconds() { return Integer.parseInt(String.valueOf(section("client").getOrDefault("heartbeatSeconds", 10))); }
    public String logDir() { return String.valueOf(section("log").getOrDefault("dir", "logs")); }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> agents() {
        Object o = root.get("agents");
        return o instanceof List ? (List<Map<String, Object>>) o : List.of();
    }
}
