package com.yonyong.talos.agent;

import org.yaml.snakeyaml.Yaml;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/** 客户端配置：conf/agent.yml */
public class AgentConfig {

    private final Map<String, Object> root;

    @SuppressWarnings("unchecked")
    public AgentConfig(Path file) throws Exception {
        if (!Files.exists(file)) throw new IllegalStateException("缺少配置文件: " + file);
        byte[] bytes = Files.readAllBytes(file);
        // 中文 Windows 上 setup.bat 由 cmd 写文件，中文主机名等会落成 GBK 字节；
        // 先按 UTF-8 严格解码，失败再回退 GBK，避免 yml 里有中文就启动即崩
        String text;
        try {
            text = new String(bytes, StandardCharsets.UTF_8);
            if (text.indexOf('\uFFFD') >= 0) text = new String(bytes, Charset.forName("GBK"));
        } catch (Exception e) {
            text = new String(bytes, Charset.forName("GBK"));
        }
        this.root = new Yaml().load(text);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> section(String key) {
        Object o = root.get(key);
        return o instanceof Map ? (Map<String, Object>) o : Map.of();
    }

    public String serverAddr() { return String.valueOf(section("server").getOrDefault("addr", "127.0.0.1")); }
    public int serverPort() { return Integer.parseInt(String.valueOf(section("server").getOrDefault("port", 9443))); }
    /** 服务端 HTTP 端口，用于下载升级包（控制台 8080，gRPC 9443，两者不同） */
    public int httpPort() { return Integer.parseInt(String.valueOf(section("server").getOrDefault("httpPort", 8080))); }
    public String clientId() { return String.valueOf(section("client").getOrDefault("id", "unknown-client")); }
    public String token() { return String.valueOf(section("client").getOrDefault("token", "")); }
    /** 与 server 的 talos.security.task-sign-secret 一致；为空则不校验任务签名 */
    public String signSecret() { return String.valueOf(section("client").getOrDefault("signSecret", "")); }
    public String workspace() { return String.valueOf(section("client").getOrDefault("workspace", ".")); }
    public int heartbeatSeconds() { return Integer.parseInt(String.valueOf(section("client").getOrDefault("heartbeatSeconds", 10))); }
    /** 是否接受服务端下发的静默升级；关闭后本机不会被远程替换（安全阀） */
    public boolean allowUpgrade() {
        return !"false".equalsIgnoreCase(String.valueOf(section("client").getOrDefault("allowUpgrade", "true")));
    }
    public String logDir() { return String.valueOf(section("log").getOrDefault("dir", "logs")); }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> agents() {
        Object o = root.get("agents");
        return o instanceof List ? (List<Map<String, Object>>) o : List.of();
    }
}
