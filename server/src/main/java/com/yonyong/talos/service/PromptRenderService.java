package com.yonyong.talos.service;

import com.yonyong.talos.entity.PromptTemplateEntity;
import com.yonyong.talos.repository.PromptTemplateRepository;
import dev.langchain4j.model.input.PromptTemplate;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Prompt 渲染：所有 Prompt 与拼接模板都来自配置（库），变量由系统注入。
 * 渲染后的最终内容会连同调用日志一起回传服务端，便于调试、审计与成本管控。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PromptRenderService {

    private static final Pattern VAR = Pattern.compile("\\{\\{\\s*([\\w.]+)\\s*\\}\\}");

    private final PromptTemplateRepository templateRepository;

    /** 渲染模板：LangChain4J PromptTemplate + 变量注入 */
    public RenderResult render(String templateName, Map<String, Object> vars) {
        PromptTemplateEntity tpl = templateRepository.findByName(templateName);
        Map<String, Object> safeVars = vars == null ? new HashMap<>() : new HashMap<>(vars);

        if (tpl == null) {
            log.warn("模板不存在: {}，使用空模板兜底", templateName);
            return new RenderResult(templateName, "", true);
        }
        Set<String> required = extractVars(tpl.getContent());
        boolean missing = required.stream().anyMatch(k -> !safeVars.containsKey(k) || safeVars.get(k) == null);
        // 缺失变量补空串，避免渲染抛异常
        required.forEach(k -> safeVars.putIfAbsent(k, ""));

        String text = PromptTemplate.from(tpl.getContent()).apply(safeVars).text();
        return new RenderResult(templateName, text, missing);
    }

    /** 解析模板中的 {{var}} 占位符 */
    public Set<String> extractVars(String content) {
        Set<String> vars = new java.util.LinkedHashSet<>();
        if (content == null) return vars;
        Matcher m = VAR.matcher(content);
        while (m.find()) vars.add(m.group(1));
        return vars;
    }

    public record RenderResult(String templateName, String text, boolean missingVars) {}
}
