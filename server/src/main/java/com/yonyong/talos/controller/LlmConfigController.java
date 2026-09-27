package com.yonyong.talos.controller;

import com.yonyong.talos.entity.LlmConfigEntity;
import com.yonyong.talos.repository.LlmConfigRepository;
import com.yonyong.talos.service.LlmService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 模型配置：API 形式 LLM 通道的读取、保存与连通性测试。
 *
 * <p>密钥永不回传浏览器 —— 列表接口只给「是否已配置 + 掩码」，
 * 保存时 apiKey 传空表示「保持原值」，显式 clearKey=true 才是清空。
 */
@RestController
@RequestMapping("/api/llm")
@RequiredArgsConstructor
public class LlmConfigController {

    private final LlmConfigRepository configRepository;
    private final LlmService llmService;

    /** 对外视图：apiKey 已脱敏 */
    public record ChannelView(
            Long id, String channel, String label, String provider, String baseUrl, String model,
            Double temperature, Integer timeoutSeconds, Boolean enabled, Boolean privateOnly,
            boolean hasApiKey, String apiKeyMasked, String lastTestResult,
            LocalDateTime lastTestAt, LocalDateTime updatedAt) {}

    @GetMapping("/config")
    public List<ChannelView> list() {
        List<ChannelView> out = new ArrayList<>();
        for (String ch : List.of(LlmConfigEntity.PUBLIC, LlmConfigEntity.PRIVATE)) {
            LlmConfigEntity cfg = configRepository.findByChannel(ch);
            if (cfg == null) continue;
            out.add(view(cfg));
        }
        return out;
    }

    @PostMapping("/config")
    public ResponseEntity<Object> save(@RequestBody Map<String, Object> body) {
        String channel = str(body.get("channel"));
        if (channel == null || channel.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "channel 不能为空"));
        }
        if (!LlmConfigEntity.PUBLIC.equals(channel) && !LlmConfigEntity.PRIVATE.equals(channel)) {
            return ResponseEntity.badRequest().body(Map.of("message", "channel 只能是 PUBLIC 或 PRIVATE"));
        }

        LlmConfigEntity t = configRepository.findByChannel(channel);
        boolean created = t == null;
        if (created) {
            t = new LlmConfigEntity();
            t.setChannel(channel);
            t.setEnabled(true);
        }
        if (body.containsKey("label")) t.setLabel(str(body.get("label")));
        if (body.containsKey("provider")) t.setProvider(str(body.get("provider")));
        if (body.containsKey("baseUrl")) t.setBaseUrl(str(body.get("baseUrl")));
        if (body.containsKey("model")) t.setModel(str(body.get("model")));
        if (body.containsKey("temperature")) t.setTemperature(dbl(body.get("temperature")));
        if (body.containsKey("timeoutSeconds")) t.setTimeoutSeconds(intg(body.get("timeoutSeconds")));
        if (body.containsKey("enabled")) t.setEnabled(bool(body.get("enabled")));
        if (body.containsKey("privateOnly")) t.setPrivateOnly(bool(body.get("privateOnly")));

        // 密钥三态：显式清空 / 传了新值 / 保持原值
        if (Boolean.TRUE.equals(bool(body.get("clearKey")))) {
            t.setApiKey(null);
        } else {
            String key = str(body.get("apiKey"));
            if (key != null && !key.isBlank()) t.setApiKey(key.trim());
        }

        if (created && t.getEnabled() == null) t.setEnabled(Boolean.TRUE);
        t.setUpdatedAt(LocalDateTime.now());
        if (t.getLabel() == null || t.getLabel().isBlank()) {
            t.setLabel(LlmConfigEntity.PUBLIC.equals(channel) ? "公网通道" : "私有化通道");
        }
        configRepository.save(t);

        // 无缓存可失效 —— LlmService 每次调用现读配置，这里保存完即已生效
        return ResponseEntity.ok(view(t));
    }

    @PostMapping("/test")
    public Map<String, Object> test(@RequestBody Map<String, String> body) {
        String channel = body == null ? null : body.get("channel");
        if (channel == null || channel.isBlank()) {
            return Map.of("ok", false, "message", "channel 不能为空");
        }
        LlmService.TestResult r = llmService.test(channel);
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("ok", r.ok());
        m.put("message", r.message());
        m.put("latencyMs", r.latencyMs());
        m.put("sample", r.sample());
        return m;
    }

    /* ==================== 工具 ==================== */

    private static ChannelView view(LlmConfigEntity c) {
        boolean has = c.getApiKey() != null && !c.getApiKey().isBlank();
        return new ChannelView(c.getId(), c.getChannel(), c.getLabel(), c.getProvider(), c.getBaseUrl(),
                c.getModel(), c.getTemperature(), c.getTimeoutSeconds(),
                Boolean.TRUE.equals(c.getEnabled()), Boolean.TRUE.equals(c.getPrivateOnly()),
                has, mask(c.getApiKey()), c.getLastTestResult(), c.getLastTestAt(), c.getUpdatedAt());
    }

    /** 只露前 3 后 4，中间固定长度星号 —— 不泄露密钥长度 */
    private static String mask(String key) {
        if (key == null || key.isBlank()) return null;
        String k = key.trim();
        if (k.length() <= 7) return "****";
        return k.substring(0, 3) + "****" + k.substring(k.length() - 4);
    }

    private static String str(Object o) { return o == null ? null : String.valueOf(o); }

    private static Boolean bool(Object o) {
        if (o == null) return null;
        if (o instanceof Boolean b) return b;
        return Boolean.parseBoolean(String.valueOf(o));
    }

    private static Double dbl(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.doubleValue();
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : Double.parseDouble(s);
    }

    private static Integer intg(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.intValue();
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : Integer.parseInt(s);
    }
}
