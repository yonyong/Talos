package com.yonyong.talos.service;

import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.entity.KbDocEntity;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.service.PromptRenderService.RenderResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 准入判定 + 项目分拣：
 * 1) 规则前置（字段完整性、明显重复）
 * 2) 知识库召回
 * 3) LangChain4J 渲染 Prompt → 大模型判定
 * 4) 分拣：匹配项目与仓库地址
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdmissionService {

    private static final Pattern CONF = Pattern.compile("置信度[:：]\\s*([0-9.]+)");
    private static final String TEMPLATE = "admission_judge.md";

    private final IssueRepository issueRepository;
    private final UserRepository userRepository;
    private final KnowledgeService knowledgeService;
    private final PromptRenderService promptRenderService;
    private final LlmService llmService;
    private final AiLogService aiLogService;

    /** 判定入口 */
    public IssueEntity judge(String issueCode) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);

        // 1) 规则前置
        if (issue.getTitle() == null || issue.getTitle().isBlank() || issue.getDescription() == null || issue.getDescription().isBlank()) {
            finish(issue, "reject", 0.3, "描述不完整，无法评估，请补充现象与期望结果", List.of());
            return issueRepository.save(issue);
        }

        // 2) 知识库召回
        List<KnowledgeService.Hit> hits = knowledgeService.search(issue.getTitle() + " " + issue.getDescription(), 5);
        String hitsText = hits.isEmpty() ? "（无命中）" : hits.stream()
                .map(h -> String.format("- %s（相似度 %.2f）", h.doc().getName(), h.sim()))
                .reduce("", (a, b) -> a + b + "\n");

        // 3) Prompt 渲染 + LLM 判定
        Map<String, Object> vars = new HashMap<>();
        vars.put("issue.code", issue.getCode());
        vars.put("issue.type", issue.getType());
        vars.put("issue.title", issue.getTitle());
        vars.put("issue.desc", issue.getDescription());
        vars.put("issue.priority", issue.getPriority());
        vars.put("kb.hits", hitsText);

        RenderResult rr = promptRenderService.render(TEMPLATE, vars);
        long t = System.currentTimeMillis();
        String out = llmService.chatPublic(rr.text());
        long cost = System.currentTimeMillis() - t;

        aiLogService.record(issue.getCode(), "准入判定", "服务端LLM", llmService.publicModelName(),
                rr.text(), rr.missingVars(), cost, 0L, BigDecimal.ZERO, null);

        // 4) 解析结论
        String result = out != null && out.contains("reject") ? "reject" : "admit";
        Matcher m = CONF.matcher(out == null ? "" : out);
        double confidence = m.find() ? Double.parseDouble(m.group(1)) : 0.8;

        finish(issue, result, confidence, out, hits);

        // 5) 分拣（准入通过才分拣）
        if ("admit".equals(result)) sort(issue, hits);

        return issueRepository.save(issue);
    }

    /** 项目分拣：命中知识库与关键词映射，得到项目与仓库 */
    private void sort(IssueEntity issue, List<KnowledgeService.Hit> hits) {
        String text = (issue.getTitle() + " " + issue.getDescription());
        if (!hits.isEmpty()) {
            KbDocEntity top = hits.get(0).doc();
            issue.setProject(guessProject(text, top.getName()));
        } else {
            issue.setProject(guessProject(text, null));
        }
        issue.setRepoUrl("git@git.yonyong.dev:" + issue.getProject() + "/" + issue.getProject() + ".git");
        issue.setStatus("sorting");
    }

    private String guessProject(String text, String kbName) {
        String t = (text + " " + (kbName == null ? "" : kbName)).toLowerCase();
        if (t.contains("行情") || t.contains("快照") || t.contains("quote")) return "quote-service";
        if (t.contains("回测") || t.contains("backtest")) return "backtest-api";
        if (t.contains("账户") || t.contains("登录")) return "account-center";
        if (t.contains("研报") || t.contains("资讯")) return "research-search";
        return "unknown-project";
    }

    /** 人工覆写 */
    public IssueEntity override(String issueCode, String result, String operatorEmpNo) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) throw new IllegalArgumentException("Issue 不存在: " + issueCode);
        finish(issue, result, 1.0, "人工覆写（操作人 " + operatorEmpNo + "）", List.of());
        return issueRepository.save(issue);
    }

    private void finish(IssueEntity issue, String result, double confidence, String reason, List<KnowledgeService.Hit> hits) {
        issue.setAdmissionResult(result);
        issue.setConfidence(confidence);
        issue.setAdmissionReason(reason);
        issue.setStatus("admit".equals(result) ? "admitted" : "rejected");
        if (!hits.isEmpty()) {
            issue.setKbHits(hits.stream().map(h -> h.doc().getName() + ":" + String.format("%.2f", h.sim()))
                    .reduce("", (a, b) -> a.isEmpty() ? b : a + "," + b));
        }
    }
}
