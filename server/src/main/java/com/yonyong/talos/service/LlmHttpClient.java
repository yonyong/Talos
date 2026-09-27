package com.yonyong.talos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * OpenAI 兼容的极简对话客户端（不引入额外依赖，直接用 JDK HttpClient）。
 *
 * <p>为什么不用 langchain4j 的 OpenAiChatModel：
 * 项目里 dev.langchain4j:langchain4j 在 0.35.0 是空壳聚合包（不含 model 实现），
 * 接入需要再引 langchain4j-open-ai 及其 okhttp 传递依赖。而这里的需求只是
 * 「发一条 prompt、取回一段文本」，自建客户端可以做到零新依赖，并且把
 * 超时、耗时、HTTP 状态码与错误正文完全暴露出来 —— 「测试连通性」功能正需要这些。
 *
 * <p>本类无状态，可安全地被多线程复用；每次调用一次性构造 request。
 */
public final class LlmHttpClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 复用连接池，避免每次调用重建 TLS 握手 */
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private LlmHttpClient() {}

    /** 单次调用结果：耗时、HTTP 状态、模型回复原文 */
    public record ChatResult(String text, long latencyMs, int statusCode) {}

    /**
     * @param baseUrl          OpenAI 兼容基址（可带或不带结尾斜杠，可带或不带 /v1）
     * @param apiKey           密钥；直接放 Authorization: Bearer
     * @param model            模型名
     * @param prompt           用户消息
     * @param temperature      采样温度，可为 null
     * @param timeoutSeconds   读超时秒数，可为 null（默认 60）
     */
    public static ChatResult chat(String baseUrl, String apiKey, String model, String prompt,
                                  Double temperature, Integer timeoutSeconds) throws Exception {
        String url = completionsUrl(baseUrl);
        int timeout = timeoutSeconds == null || timeoutSeconds <= 0 ? 60 : timeoutSeconds;

        ObjectNode body = MAPPER.createObjectNode();
        body.put("model", model);
        ArrayNode messages = body.putArray("messages");
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", prompt == null ? "" : prompt);
        if (temperature != null) body.put("temperature", temperature);
        // 关闭流式：一次性取回完整结论，便于正则解析（结论：pass / blocked）
        body.put("stream", false);

        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(timeout))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + (apiKey == null ? "" : apiKey))
                .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                .build();

        long t0 = System.currentTimeMillis();
        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        long cost = System.currentTimeMillis() - t0;

        if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
            // 把服务端返回的错误正文透出来，否则用户只看到 401/404 无从下手
            throw new IllegalStateException("HTTP " + resp.statusCode() + " · " + brief(resp.body()));
        }
        return new ChatResult(extractContent(resp.body()), cost, resp.statusCode());
    }

    /** 拼 /chat/completions，兼容用户填到 /v1 或直接填根地址两种写法 */
    static String completionsUrl(String baseUrl) {
        String b = baseUrl == null ? "" : baseUrl.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.isEmpty()) throw new IllegalArgumentException("baseUrl 未配置");
        if (b.endsWith("/chat/completions")) return b;
        return b + "/chat/completions";
    }

    /** 解析 choices[0].message.content，兼容部分服务商返回 choices[0].text */
    static String extractContent(String raw) throws Exception {
        if (raw == null || raw.isBlank()) throw new IllegalStateException("响应体为空");
        JsonNode root = MAPPER.readTree(raw);
        JsonNode choices = root.path("choices");
        if (choices.isArray() && choices.size() > 0) {
            JsonNode first = choices.get(0);
            JsonNode content = first.path("message").path("content");
            if (content.isTextual()) return content.asText();
            JsonNode text = first.path("text");
            if (text.isTextual()) return text.asText();
        }
        // 有些网关把错误塞在 200 里
        JsonNode err = root.path("error");
        if (!err.isMissingNode() && !err.isNull()) {
            throw new IllegalStateException("接口返回错误：" + brief(err.toString()));
        }
        throw new IllegalStateException("无法解析响应：" + brief(raw));
    }

    private static String brief(String s) {
        if (s == null) return "";
        String one = s.replaceAll("\\s+", " ").trim();
        return one.length() > 300 ? one.substring(0, 300) + "…" : one;
    }
}
