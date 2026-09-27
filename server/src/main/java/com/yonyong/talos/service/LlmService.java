package com.yonyong.talos.service;

import com.yonyong.talos.entity.LlmConfigEntity;
import com.yonyong.talos.repository.LlmConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 大模型调用：
 * <ul>
 *   <li>公网通道（千问 / 智普 / 任意 OpenAI 兼容端点）：准入判定、业务域分拣、通用 QA，不涉及代码</li>
 *   <li>私有化通道：涉及代码的故障分析、编码、文档生成，默认不出内网</li>
 * </ul>
 *
 * <p><b>热生效</b>：配置全部落在 t_llm_config，本类不做任何启动期 Bean 注入，
 * 每次调用现读一行配置再发起请求 —— 因此控制台上改完 key / baseUrl / model 立刻生效，
 * 不需要重启服务。客户端本身无状态，也就没有缓存失效的问题。
 *
 * <p><b>降级</b>：通道未配置、被停用、或调用失败时返回结构化兜底文本，保证流程不阻塞。
 * 兜底文本一律带「结论：xxx」形式，上层按键值解析；解析不出即由其自身的 fail-safe 规则接管。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LlmService {

    private final LlmConfigRepository configRepository;

    /**
     * 降级应答是否允许「默认准入」。
     * <p>默认 true，保持「未配置模型时流程仍可跑通」的既有行为；
     * 设为 false 后未配置模型时准入判定一律不放行（严格 fail-safe，需人工复核）。
     */
    @Value("${talos.llm.fallback-allow-admit:true}")
    private boolean fallbackAllowAdmit;

    /** 公网通道：准入 / 分拣 / QA */
    public String chatPublic(String prompt) {
        return chat(LlmConfigEntity.PUBLIC, prompt);
    }

    /** 私有化通道：涉及代码，默认不出内网 */
    public String chatPrivate(String prompt) {
        return chat(LlmConfigEntity.PRIVATE, prompt);
    }

    private String chat(String channel, String prompt) {
        LlmConfigEntity cfg = configRepository.findByChannel(channel);
        String reason = unusableReason(cfg);
        if (reason != null) {
            log.warn("LLM 通道 {} 不可用（{}），降级为规则应答", channel, reason);
            return fallback(prompt);
        }
        try {
            LlmHttpClient.ChatResult r = LlmHttpClient.chat(cfg.getBaseUrl(), cfg.getApiKey(), cfg.getModel(),
                    prompt, cfg.getTemperature(), cfg.getTimeoutSeconds());
            log.info("LLM 通道 {} 模型 {} 调用成功，耗时 {}ms", channel, cfg.getModel(), r.latencyMs());
            return r.text();
        } catch (Exception e) {
            log.warn("LLM 通道 {} 调用失败，降级为规则应答: {}", channel, e.toString());
            return fallback(prompt);
        }
    }

    /** 当前生效的模型名，用于 AI 调用日志落库 */
    public String publicModelName() {
        return nameOf(LlmConfigEntity.PUBLIC, "—");
    }

    public String privateModelName() {
        return nameOf(LlmConfigEntity.PRIVATE, "—");
    }

    private String nameOf(String channel, String dft) {
        LlmConfigEntity cfg = configRepository.findByChannel(channel);
        if (cfg == null || cfg.getModel() == null || cfg.getModel().isBlank()) return dft;
        return cfg.getModel();
    }

    /* ==================== 连通性测试 ==================== */

    public record TestResult(boolean ok, String message, long latencyMs, String sample) {}

    /**
     * 发一条真实请求验证通道可用。与 chat 的区别：这里**不降级**，
     * 失败原因（DNS / 超时 / 401 / 模型不存在）原样返回，方便用户在页面上定位。
     */
    public TestResult test(String channel) {
        LlmConfigEntity cfg = configRepository.findByChannel(channel);
        if (cfg == null) return new TestResult(false, "通道配置不存在", 0, null);

        String reason = unusableReason(cfg);
        if (reason != null) {
            return new TestResult(false, reason, 0, null);
        }
        try {
            LlmHttpClient.ChatResult r = LlmHttpClient.chat(cfg.getBaseUrl(), cfg.getApiKey(), cfg.getModel(),
                    "连通性测试：请只回复两个字「正常」。", cfg.getTemperature(), cfg.getTimeoutSeconds());
            markTest(cfg, "连通正常 · " + r.latencyMs() + "ms");
            return new TestResult(true, "连通正常", r.latencyMs(), r.text());
        } catch (Exception e) {
            String msg = e instanceof java.net.http.HttpTimeoutException
                    ? "请求超时（" + (cfg.getTimeoutSeconds() == null ? 60 : cfg.getTimeoutSeconds()) + "s）"
                    : (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            markTest(cfg, "失败 · " + msg);
            return new TestResult(false, msg, 0, null);
        }
    }

    private void markTest(LlmConfigEntity cfg, String result) {
        try {
            cfg.setLastTestResult(result.length() > 250 ? result.substring(0, 250) : result);
            cfg.setLastTestAt(LocalDateTime.now());
            configRepository.save(cfg);
        } catch (Exception e) {
            log.debug("记录连通性测试结果失败: {}", e.toString());
        }
    }

    /* ==================== 内部 ==================== */

    /** 返回不可用原因；返回 null 表示可用 */
    private static String unusableReason(LlmConfigEntity cfg) {
        if (cfg == null) return "通道未配置";
        if (!Boolean.TRUE.equals(cfg.getEnabled())) return "通道已停用";
        if (cfg.getBaseUrl() == null || cfg.getBaseUrl().isBlank()) return "baseUrl 未配置";
        if (cfg.getApiKey() == null || cfg.getApiKey().isBlank()) return "apiKey 未配置";
        if (cfg.getModel() == null || cfg.getModel().isBlank()) return "model 未配置";
        return null;
    }

    /** 无模型时的兜底：尽量给出结构化结论，避免阻塞流程 */
    private String fallback(String prompt) {
        String p = prompt == null ? "" : prompt.toLowerCase();
        if (p.contains("准入") || p.contains("admit")) {
            // 严格 fail-safe 模式下不再默认准入，交由 AdmissionService 按「解析不出结论」处理
            return fallbackAllowAdmit
                    ? "结论：admit\n置信度：0.80\n理由：未配置模型，按规则默认准入（建议人工复核）"
                    : "结论：unknown\n置信度：0.00\n理由：未配置模型，严格 fail-safe 下不默认准入，需人工复核";
        }
        return "结论：unknown\n置信度：0.50\n理由：未配置模型，无法判定";
    }
}
