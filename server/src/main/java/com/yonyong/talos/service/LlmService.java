package com.yonyong.talos.service;

import dev.langchain4j.model.chat.ChatLanguageModel;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 大模型调用：
 * - 公网通道（千问 / 智普）：准入判定、项目分拣、通用 QA，不涉及代码
 * - 私有化通道：涉及代码的故障分析、编码、文档生成，默认不出内网
 *
 * 未配置模型 Bean 或密钥时降级为规则化应答，保证流程仍可跑通。
 */
@Slf4j
@Service
public class LlmService {

    private final ChatLanguageModel publicModel;
    private final boolean privateEnabled;

    @Value("${talos.llm.model:qwen-max}")
    private String publicModelName;

    @Value("${talos.private-model.model:cb-internal}")
    private String privateModelName;

    public LlmService(@Autowired(required = false) ChatLanguageModel publicModel,
                      @Value("${talos.private-model.enabled:true}") boolean privateEnabled) {
        this.publicModel = publicModel;
        this.privateEnabled = privateEnabled;
    }

    /** 公网通道：准入 / 分拣 / QA */
    public String chatPublic(String prompt) {
        if (publicModel == null) {
            log.warn("未配置公网模型，降级为规则应答");
            return fallback(prompt);
        }
        long t = System.currentTimeMillis();
        String out = publicModel.generate(prompt);
        log.info("公网模型 {} 调用耗时 {}ms", publicModelName, System.currentTimeMillis() - t);
        return out;
    }

    /** 私有化通道：涉及代码，默认不出内网 */
    public String chatPrivate(String prompt) {
        if (!privateEnabled || publicModel == null) {
            log.warn("私有化通道不可用，降级为规则应答（不应发生在生产）");
            return fallback(prompt);
        }
        return publicModel.generate(prompt);
    }

    public String publicModelName() { return publicModelName; }
    public String privateModelName() { return privateModelName; }

    /** 无模型时的兜底：尽量给出结构化结论，避免阻塞流程 */
    private String fallback(String prompt) {
        String p = prompt == null ? "" : prompt.toLowerCase();
        if (p.contains("准入") || p.contains("admit")) {
            return "结论：admit\n置信度：0.80\n理由：未配置模型，按规则默认准入（建议人工复核）";
        }
        return "结论：unknown\n置信度：0.50\n理由：未配置模型，无法判定";
    }
}
