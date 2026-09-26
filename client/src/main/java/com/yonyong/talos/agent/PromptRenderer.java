package com.yonyong.talos.agent;

import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Prompt 渲染：模板来自服务端配置，变量由系统注入后替换（客户端执行，渲染结果回传服务端） */
public class PromptRenderer {

    private static final Pattern VAR = Pattern.compile("\\{\\{\\s*([\\w.]+)\\s*\\}\\}");

    public static String render(String template, Map<String, Object> vars) {
        if (template == null) return "";
        Map<String, Object> safe = vars == null ? Map.of() : vars;
        Matcher m = VAR.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            Object v = safe.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(v == null ? "" : String.valueOf(v)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    public static Set<String> variablesOf(String template) {
        Set<String> vars = new java.util.LinkedHashSet<>();
        if (template == null) return vars;
        Matcher m = VAR.matcher(template);
        while (m.find()) vars.add(m.group(1));
        return vars;
    }
}
