package com.yonyong.talos.service;

import com.yonyong.talos.entity.BizDomainEntity;
import com.yonyong.talos.entity.RepoEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.BizDomainRepository;
import com.yonyong.talos.repository.RepoRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.service.PromptRenderService.RenderResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 分拣引擎：业务域 → 仓库。
 *
 * 命中顺序：人工指定 &gt; 关键词命中 &gt; 父子层级收敛（子域优先）&gt; LLM 歧义裁决 &gt; 待人工分拣。
 * 所有 LLM 判定均 fail-safe：调用失败或结论不在候选中，一律降级为「待人工」，
 * 绝不静默兜底到某个默认业务域。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SortService {

    private static final Pattern CODE = Pattern.compile("结论[:：]\\s*([A-Za-z0-9_-]+)");
    private static final String TEMPLATE = "biz_sort.md";

    private final BizDomainRepository bizDomainRepository;
    private final RepoRepository repoRepository;
    private final UserRepository userRepository;
    private final ClientRegistry clientRegistry;
    private final PromptRenderService promptRenderService;
    private final LlmService llmService;
    private final AiLogService aiLogService;

    /** 候选业务域：命中的关键词一并带回，便于人工复核裁决依据 */
    public record Candidate(String code, String name, List<String> matched) {}

    /** 分拣结果。resolved=false 表示需人工介入，此时只有 method/reason/candidates 有意义 */
    public record Result(
            boolean resolved, String method, String reason,
            String bizCode, String bizName, String owner,
            String project, String repoUrl, String baselineBranch, String branch,
            String priority, String clientId,
            String sensitiveLevel, boolean sensitiveRepo, String requiredBackend,
            /** 命中子业务域且关键配置来自祖先时，记录实际提供方；否则为 null */
            String inheritedFrom,
            List<Candidate> candidates
    ) {}

    /**
     * @param issueCode   用于生成工作分支；预览场景可传 null
     * @param explicitBiz 人工指定（业务域 code 或 name），为空则走关键词匹配
     */
    public Result sort(String issueCode, String title, String desc, String explicitBiz) {
        String text = ((title == null ? "" : title) + " " + (desc == null ? "" : desc)).toLowerCase();

        // 1) 人工指定业务域：直接采信，不再猜测
        BizDomainEntity explicit = matchExplicit(explicitBiz);
        if (explicit != null) {
            List<Candidate> one = List.of(new Candidate(explicit.getCode(), explicit.getName(), List.of("人工指定")));
            return resolve(issueCode, explicit, "manual", "人工指定业务域：" + explicit.getName(), one);
        }

        // 2) 关键词匹配全部启用业务域
        List<Candidate> matched = new ArrayList<>();
        for (BizDomainEntity d : bizDomainRepository.findByEnabledTrueOrderByCodeAsc()) {
            List<String> hit = new ArrayList<>();
            for (String kw : split(d.getKeywords())) {
                if (!kw.isEmpty() && text.contains(kw.toLowerCase())) hit.add(kw);
            }
            if (!hit.isEmpty()) matched.add(new Candidate(d.getCode(), d.getName(), hit));
        }

        // 3) 零命中 → 待人工，不再返回 unknown-project 静默通过
        if (matched.isEmpty()) {
            return unresolved("none", "标题与描述未命中任何业务域关键词，已进入人工分拣队列");
        }

        // 4) 层级收敛：父子同时命中时更具体的子域优先，父域让位，这不算歧义
        List<Candidate> hits = narrowByDepth(matched);

        // 5) 唯一命中 → 直定
        if (hits.size() == 1) {
            Candidate only = hits.get(0);
            BizDomainEntity d = bizDomainRepository.findByCode(only.code());
            String why = matched.size() > 1
                    ? "关键词命中 " + matched.size() + " 个业务域（含父子层级），按「更具体的子业务域优先」收敛到「" + only.name() + "」"
                    : "关键词唯一命中「" + String.join("、", only.matched()) + "」→ " + only.name();
            return resolve(issueCode, d, "auto", why, hits);
        }

        // 6) 多命中 → LLM 裁决
        return arbitrate(issueCode, title, desc, hits);
    }

    /**
     * 层级收敛：候选里存在祖先-后代关系时，祖先让位给更具体的后代。
     * 用于「行情」与其子域「行情·快照导出」同时命中关键词的场景 ——
     * 这属于正常的层级包含，不应被当成需要 LLM 裁决的歧义。
     */
    private List<Candidate> narrowByDepth(List<Candidate> candidates) {
        if (candidates.size() <= 1) return candidates;
        List<Candidate> kept = new ArrayList<>();
        for (Candidate c : candidates) {
            boolean shadowed = false;
            for (Candidate other : candidates) {
                if (other.code().equals(c.code())) continue;
                if (isAncestor(c.code(), other.code())) { shadowed = true; break; }
            }
            if (!shadowed) kept.add(c);
        }
        return kept.isEmpty() ? candidates : kept;
    }

    /** ancestorCode 是否位于 descendantCode 的祖先链上 */
    private boolean isAncestor(String ancestorCode, String descendantCode) {
        if (ancestorCode == null || descendantCode == null || ancestorCode.equals(descendantCode)) return false;
        BizDomainEntity d = bizDomainRepository.findByCode(descendantCode);
        if (d == null) return false;
        for (BizDomainEntity x : chainOf(d)) {
            if (ancestorCode.equals(x.getCode()) && !ancestorCode.equals(descendantCode)) return true;
        }
        return false;
    }

    /** LLM 歧义裁决：fail-safe，解析不出即转人工 */
    private Result arbitrate(String issueCode, String title, String desc, List<Candidate> hits) {
        StringBuilder sb = new StringBuilder();
        for (Candidate c : hits) {
            sb.append("- ").append(c.code()).append("（").append(c.name()).append("）")
                    .append(" 命中关键词：").append(String.join("、", c.matched())).append("\n");
        }
        Map<String, Object> vars = new HashMap<>();
        vars.put("issue.code", issueCode == null ? "—" : issueCode);
        vars.put("issue.title", title == null ? "" : title);
        vars.put("issue.desc", desc == null ? "" : desc);
        vars.put("biz.candidates", sb.toString().trim());

        RenderResult rr = promptRenderService.render(TEMPLATE, vars);
        long t = System.currentTimeMillis();
        String out = null;
        try {
            out = llmService.chatPublic(rr.text());
        } catch (Exception e) {
            log.warn("分拣歧义裁决调用失败，降级为人工分拣: {}", e.toString());
        }
        aiLogService.record(issueCode, "业务域分拣·歧义裁决", "服务端LLM", llmService.publicModelName(),
                rr.text(), rr.missingVars(), System.currentTimeMillis() - t, 0L, BigDecimal.ZERO, null);

        Matcher m = CODE.matcher(out == null ? "" : out);
        String picked = m.find() ? m.group(1) : null;
        Candidate chosen = picked == null ? null
                : hits.stream().filter(c -> c.code().equalsIgnoreCase(picked)).findFirst().orElse(null);

        String names = hits.stream().map(Candidate::name).reduce((a, b) -> a + "、" + b).orElse("");
        if (chosen == null) {
            // 必须把候选带回，前端才能显示「歧义在哪几个业务域之间」
            return unresolved("none",
                    "多个业务域同时命中（" + names + "），但 LLM 裁决不可用或结论不在候选中，已按 fail-safe 转人工分拣", hits);
        }
        BizDomainEntity d = bizDomainRepository.findByCode(chosen.code());
        return resolve(issueCode, d, "llm", "歧义裁决命中「" + chosen.name() + "」（候选：" + names + "）", hits);
    }

    /**
     * 业务域 → 仓库，组装最终结果。
     *
     * <p>子业务域可以只配编码 + 关键词 + 负责人，其余沿父链继承：
     * 仓库按「自身 → 父 → 祖父」找第一个绑定，开发/业务负责人、优先级、
     * 敏感等级、执行客户端按「自身非空优先」逐级上取。
     * 承接人 = 链上第一个非空开发负责人的第 1 顺位；无开发负责人时退回业务负责人。
     * 工作流模板不在这里解析 —— start() 按 issue.type 选模板。
     */
    private Result resolve(String issueCode, BizDomainEntity d, String method, String reason, List<Candidate> candidates) {
        if (d == null) {
            return unresolved("none", "命中的业务域配置已失效，请在「业务管理」中检查后重新分拣");
        }
        List<BizDomainEntity> chain = chainOf(d);

        // 仓库：沿父链找第一个绑定（绑定存业务域侧 repoProject，一仓可服务多域）
        RepoEntity repo = null;
        String repoOwnerCode = null;
        for (BizDomainEntity x : chain) {
            String rp = x.getRepoProject();
            if (rp == null || rp.isBlank()) continue;
            RepoEntity hit = repoRepository.findByProject(rp.trim());
            if (hit != null) {
                repo = hit;
                repoOwnerCode = x.getCode();
                break;
            }
        }

        String project = null, repoUrl = null, baseline = null, branch = null, requiredBackend = null;
        boolean sensitiveRepo = false;
        if (repo == null) {
            reason = reason + "；该业务域及其父级均未配置仓库，下发前需补齐";
        } else {
            project = repo.getProject();
            repoUrl = repo.getRepoUrl();
            baseline = repo.getBaselineBranch();
            sensitiveRepo = Boolean.TRUE.equals(repo.getSensitive());
            requiredBackend = repo.getRequiredBackend();
            String prefix = repo.getBranchPrefix() == null ? "" : repo.getBranchPrefix();
            if (issueCode != null && !issueCode.isBlank()) branch = prefix + issueCode.toLowerCase();
        }

        String owner = firstOf(chain, BizDomainEntity::getDevOwners);
        if (owner == null) owner = firstOf(chain, BizDomainEntity::getBizOwners);
        String priority = pick(chain, BizDomainEntity::getDefaultPriority);
        // 执行客户端：责任人驱动解析（开发责任人顺位 → 业务负责人 → 域默认值兜底）
        ClientPick cp = resolveClientId(chain);
        String clientId = cp == null ? null : cp.clientId();
        if (cp != null) reason = reason + "；" + cp.note();
        String sensitiveLevel = pick(chain, BizDomainEntity::getSensitiveLevel);

        // 逐字段算提供方，任何一个来自祖先就记录链上最近的那个祖先
        Set<String> fromAncestors = new LinkedHashSet<>();
        if (repoOwnerCode != null && !Objects.equals(repoOwnerCode, d.getCode())) fromAncestors.add(repoOwnerCode);
        for (Function<BizDomainEntity, String> g : List.<Function<BizDomainEntity, String>>of(
                BizDomainEntity::getDevOwners, BizDomainEntity::getBizOwners,
                BizDomainEntity::getDefaultPriority, BizDomainEntity::getDefaultClientId,
                BizDomainEntity::getSensitiveLevel)) {
            BizDomainEntity p = providerOf(chain, g);
            if (p != null && !Objects.equals(p.getCode(), d.getCode())) fromAncestors.add(p.getCode());
        }
        String from = null;
        for (BizDomainEntity x : chain) {
            if (Objects.equals(x.getCode(), d.getCode())) continue;
            if (fromAncestors.contains(x.getCode())) { from = x.getCode(); break; }
        }
        if (from != null) {
            reason = reason + "；未在子域配置的项继承自父业务域 " + from;
        }

        return new Result(true, method, reason, d.getCode(), d.getName(), owner,
                project, repoUrl, baseline, branch,
                priority, clientId,
                sensitiveLevel, sensitiveRepo, requiredBackend, from, candidates);
    }

    /**
     * 执行客户端解析（责任人驱动）：
     * ① 沿开发责任人顺位找第一个「已绑定客户端且在线」的；
     * ② 全部离线 → 分给第一个有绑定客户端的开发责任人，待其重新注册后由 resumeQueued 补发；
     * ③ 开发责任人均未绑定 → 业务负责人同规则 → 最后退回业务域默认执行客户端。
     * 返回 null 表示无人可分，启动工作流时应拦截。
     */
    private ClientPick resolveClientId(List<BizDomainEntity> chain) {
        ClientPick dev = pickByOwners(chain, BizDomainEntity::getDevOwners, "开发责任人");
        if (dev != null) return dev;
        ClientPick biz = pickByOwners(chain, BizDomainEntity::getBizOwners, "业务负责人");
        if (biz != null) return biz;
        String def = pick(chain, BizDomainEntity::getDefaultClientId);
        if (def != null && !def.isBlank()) {
            String cid = def.trim();
            return new ClientPick(cid, "执行客户端 " + cid
                    + (clientRegistry.isOnline(cid) ? "（业务域默认 · 在线）" : "（业务域默认 · 离线，上线后自动补发）"));
        }
        return null;
    }

    /** 按负责人顺位找客户端：第一个「已绑定且在线」的直接命中；全离线返回第一个有绑定的（待上线补发） */
    private ClientPick pickByOwners(List<BizDomainEntity> chain, Function<BizDomainEntity, String> getter, String label) {
        String offlineCid = null, offlineOwner = null;
        for (String name : ownersOf(chain, getter)) {
            UserEntity u = userRepository.findFirstByName(name);
            if (u == null || u.getClientId() == null || u.getClientId().isBlank()) continue;
            String cid = u.getClientId().trim();
            if (clientRegistry.isOnline(cid)) {
                return new ClientPick(cid, "执行客户端 " + cid + "（" + label + " " + name + " · 在线）");
            }
            if (offlineCid == null) { offlineCid = cid; offlineOwner = name; }
        }
        if (offlineCid != null) {
            return new ClientPick(offlineCid, "执行客户端 " + offlineCid
                    + "（" + label + " " + offlineOwner + " · 离线，上线后自动补发）");
        }
        return null;
    }

    /** 链上第一个非空多人字段的完整顺位名单 */
    private static List<String> ownersOf(List<BizDomainEntity> chain, Function<BizDomainEntity, String> getter) {
        String v = pick(chain, getter);
        if (v == null || v.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        for (String s : v.split("[,，、;；\\s]+")) {
            if (!s.isBlank()) out.add(s.trim());
        }
        return out;
    }

    /** 执行客户端解析结果：clientId + 写入分拣理由的说明 */
    private record ClientPick(String clientId, String note) {}

    /** 沿 parentCode 向上收集祖先链（含自身），遇环即止 */
    private List<BizDomainEntity> chainOf(BizDomainEntity d) {
        List<BizDomainEntity> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        BizDomainEntity cur = d;
        while (cur != null && cur.getCode() != null && seen.add(cur.getCode())) {
            out.add(cur);
            String p = cur.getParentCode();
            cur = (p == null || p.isBlank()) ? null : bizDomainRepository.findByCode(p);
        }
        return out;
    }

    /** 按「自身优先」取第一个非空值 */
    private static String pick(List<BizDomainEntity> chain, Function<BizDomainEntity, String> getter) {
        BizDomainEntity p = providerOf(chain, getter);
        return p == null ? null : getter.apply(p);
    }

    /** 按「自身优先」取第一个非空多人字段的第 1 顺位（主责） */
    private static String firstOf(List<BizDomainEntity> chain, Function<BizDomainEntity, String> getter) {
        String v = pick(chain, getter);
        if (v == null) return null;
        for (String s : v.split("[,，、;；\\s]+")) {
            if (!s.isBlank()) return s.trim();
        }
        return null;
    }

    /** 该字段实际由链上哪个域提供；都没有则 null */
    private static BizDomainEntity providerOf(List<BizDomainEntity> chain, Function<BizDomainEntity, String> getter) {
        for (BizDomainEntity x : chain) {
            String v = getter.apply(x);
            if (v != null && !v.isBlank()) return x;
        }
        return null;
    }

    private Result unresolved(String method, String reason) {
        return unresolved(method, reason, List.of());
    }

    private Result unresolved(String method, String reason, List<Candidate> candidates) {
        return new Result(false, method, reason, null, null, null, null, null, null, null,
                null, null, null, false, null, null, candidates);
    }

    /** 人工指定：先精确匹配 code / name，再按归一化名称模糊匹配（兼容「回测/指标」这类自由文本） */
    private BizDomainEntity matchExplicit(String explicitBiz) {
        if (explicitBiz == null || explicitBiz.isBlank()) return null;
        String v = explicitBiz.trim();
        BizDomainEntity d = bizDomainRepository.findByCode(v);
        if (d == null) d = bizDomainRepository.findByName(v);
        if (d != null) return d;

        String nv = norm(v);
        if (nv.isEmpty()) return null;
        for (BizDomainEntity x : bizDomainRepository.findAll()) {
            String nn = norm(x.getName());
            if (!nn.isEmpty() && (nn.equals(nv) || nn.contains(nv) || nv.contains(nn))) return x;
        }
        return null;
    }

    /** 去掉分隔符与空白，用于「回测/指标」↔「回测·指标」这类写法差异 */
    private static String norm(String s) {
        return s == null ? "" : s.replaceAll("[\\s/·\\\\,，、\\-—_]+", "");
    }

    private static List<String> split(String keywords) {
        if (keywords == null || keywords.isBlank()) return List.of();
        return Arrays.stream(keywords.split("[,，、;；\\s]+"))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
