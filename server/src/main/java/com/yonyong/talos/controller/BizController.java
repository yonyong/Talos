package com.yonyong.talos.controller;

import com.yonyong.talos.entity.BizDomainEntity;
import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.entity.RepoEntity;
import com.yonyong.talos.repository.BizDomainRepository;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.repository.RepoRepository;
import com.yonyong.talos.service.AutoStartService;
import com.yonyong.talos.service.SortService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 业务管理：业务域配置 + 分拣预演 + 人工重新分拣。
 * 业务域是分拣的第一依据，承载责任人、默认模板、默认优先级与敏感等级。
 */
@RestController
@RequestMapping("/api/biz")
@RequiredArgsConstructor
public class BizController {

    private final BizDomainRepository bizDomainRepository;
    private final RepoRepository repoRepository;
    private final IssueRepository issueRepository;
    private final SortService sortService;
    private final AutoStartService autoStartService;

    @GetMapping("/domains")
    public List<BizDomainEntity> list() { return bizDomainRepository.findAll(); }

    @GetMapping("/domains/{code}")
    public ResponseEntity<BizDomainEntity> get(@PathVariable String code) {
        BizDomainEntity d = bizDomainRepository.findByCode(code);
        return d == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(d);
    }

    /** 保存业务域：编码即主键语义；仓库绑定（repoProject）存在业务域自身，编码变更无需回写仓库表 */
    @PostMapping("/domains")
    public ResponseEntity<Map<String, Object>> save(@RequestBody BizDomainEntity in) {
        if (!notBlank(in.getCode())) return bad("业务编码不能为空");
        if (!notBlank(in.getName())) return bad("业务名称不能为空");
        String code = in.getCode().trim();

        BizDomainEntity exist = in.getId() != null
                ? bizDomainRepository.findById(in.getId()).orElse(null)
                : bizDomainRepository.findByCode(code);
        BizDomainEntity holder = bizDomainRepository.findByCode(code);
        if (holder != null && (exist == null || !holder.getId().equals(exist.getId()))) {
            return bad("业务编码 " + code + " 已被占用");
        }

        boolean created = exist == null;
        String oldCode = created ? null : exist.getCode();
        BizDomainEntity t = created ? new BizDomainEntity() : exist;

        // 层级校验：不能指自己、父域必须存在、不能成环
        String parent = in.getParentCode() == null ? null : in.getParentCode().trim();
        if (parent != null && !parent.isEmpty()) {
            if (parent.equals(code)) return bad("父业务域不能是自身");
            if (bizDomainRepository.findByCode(parent) == null) return bad("父业务域 " + parent + " 不存在");
            if (reachesAncestor(parent, code)) {
                return bad("父子关系会形成环：" + parent + " 的祖先链上已包含 " + code);
            }
            t.setParentCode(parent);
        } else {
            // 显式清空，或前端未传 parentCode 字段时保持原值
            if (in.getParentCode() != null || created) t.setParentCode(null);
        }

        // 绑定仓库：传非空项目名 = 绑定；传空串/空白 = 显式解绑；字段缺省 = 保持原值（如启停开关）
        if (in.getRepoProject() != null) {
            String rp = in.getRepoProject().trim();
            if (!rp.isEmpty()) {
                if (repoRepository.findByProject(rp) == null) {
                    return bad("仓库 " + rp + " 不存在，请先在「仓库管理」中创建");
                }
                t.setRepoProject(rp);
            } else {
                t.setRepoProject(null);
            }
        }

        t.setCode(code);
        t.setName(in.getName().trim());
        if (in.getKeywords() != null) t.setKeywords(in.getKeywords());
        if (in.getBizOwners() != null) t.setBizOwners(in.getBizOwners());
        if (in.getDevOwners() != null) t.setDevOwners(in.getDevOwners());
        if (in.getDefaultPriority() != null) t.setDefaultPriority(in.getDefaultPriority());
        if (in.getDefaultClientId() != null) t.setDefaultClientId(in.getDefaultClientId());
        if (in.getSensitiveLevel() != null) t.setSensitiveLevel(in.getSensitiveLevel());
        if (in.getSlaHours() != null) t.setSlaHours(in.getSlaHours());
        if (in.getDescription() != null) t.setDescription(in.getDescription());
        if (created) t.setEnabled(in.getEnabled() == null ? Boolean.TRUE : in.getEnabled());
        else if (in.getEnabled() != null) t.setEnabled(in.getEnabled());
        t.setUpdatedAt(LocalDateTime.now());
        bizDomainRepository.save(t);

        if (!created && oldCode != null && !oldCode.equals(code)) {
            // 子域的 parentCode 必须跟着改，否则层级断链（历史 Issue 的 bizCode 快照不回写；
            // 仓库绑定 repoProject 存在本域上，随本域保存自然生效，无需回写仓库表）
            for (BizDomainEntity child : bizDomainRepository.findAll()) {
                if (oldCode.equals(child.getParentCode())) {
                    child.setParentCode(code);
                    child.setUpdatedAt(LocalDateTime.now());
                    bizDomainRepository.save(child);
                }
            }
        }
        return ResponseEntity.ok(Map.<String, Object>of("saved", true, "id", t.getId(), "code", code, "created", created));
    }

    /**
     * 业务树：一级业务域为根，children 递归。
     * 每个节点附带自身仓库与继承来的仓库，前端据此标注「自有 / 继承自 xxx」。
     */
    @GetMapping("/domains/tree")
    public List<Map<String, Object>> tree() {
        List<BizDomainEntity> all = bizDomainRepository.findAll();
        Map<String, BizDomainEntity> byCode = new LinkedHashMap<>();
        for (BizDomainEntity d : all) byCode.put(d.getCode(), d);

        Map<String, List<BizDomainEntity>> childrenOf = new LinkedHashMap<>();
        for (BizDomainEntity d : all) {
            String p = d.getParentCode();
            String key = (p == null || p.isBlank() || !byCode.containsKey(p)) ? "" : p;
            childrenOf.computeIfAbsent(key, k -> new ArrayList<>()).add(d);
        }
        childrenOf.values().forEach(list -> list.sort((a, b) -> String.valueOf(a.getCode()).compareTo(String.valueOf(b.getCode()))));

        List<Map<String, Object>> roots = new ArrayList<>();
        for (BizDomainEntity r : childrenOf.getOrDefault("", List.of())) {
            roots.add(node(r, byCode, childrenOf, new ArrayList<>()));
        }
        return roots;
    }

    private Map<String, Object> node(BizDomainEntity d, Map<String, BizDomainEntity> byCode,
                                     Map<String, List<BizDomainEntity>> childrenOf, List<String> path) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.getId());
        m.put("code", d.getCode());
        m.put("name", d.getName());
        m.put("parentCode", d.getParentCode());
        m.put("repoProject", d.getRepoProject());
        m.put("keywords", d.getKeywords());
        m.put("bizOwners", d.getBizOwners());
        m.put("devOwners", d.getDevOwners());
        m.put("defaultPriority", d.getDefaultPriority());
        m.put("defaultClientId", d.getDefaultClientId());
        m.put("sensitiveLevel", d.getSensitiveLevel());
        m.put("slaHours", d.getSlaHours());
        m.put("enabled", d.getEnabled());
        m.put("description", d.getDescription());

        // 仓库来源：自身优先，否则沿父链上溯
        RepoEntity own = notBlank(d.getRepoProject()) ? repoRepository.findByProject(d.getRepoProject().trim()) : null;
        String repoFrom = null;
        RepoEntity effective = own;
        if (effective == null) {
            List<String> seen = new ArrayList<>();
            String cur = d.getParentCode();
            while (cur != null && !cur.isBlank() && byCode.containsKey(cur) && !seen.contains(cur)) {
                seen.add(cur);
                BizDomainEntity up = byCode.get(cur);
                if (notBlank(up.getRepoProject())) {
                    effective = repoRepository.findByProject(up.getRepoProject().trim());
                    repoFrom = cur;
                    break;
                }
                cur = up.getParentCode();
            }
        }
        m.put("repo", own);
        m.put("repoFrom", repoFrom);
        m.put("effectiveRepo", effective);

        // 成环时截断，避免递归失控
        List<String> next = new ArrayList<>(path);
        next.add(d.getCode());
        List<Map<String, Object>> children = new ArrayList<>();
        for (BizDomainEntity c : childrenOf.getOrDefault(d.getCode(), List.of())) {
            if (next.contains(c.getCode())) continue;
            children.add(node(c, byCode, childrenOf, next));
        }
        m.put("children", children);
        return m;
    }

    /** a 的祖先链上是否出现 target（用于成环检测） */
    private boolean reachesAncestor(String a, String target) {
        java.util.Set<String> seen = new java.util.HashSet<>();
        String cur = a;
        while (cur != null && !cur.isBlank() && seen.add(cur)) {
            if (cur.equals(target)) return true;
            BizDomainEntity e = bizDomainRepository.findByCode(cur);
            cur = e == null ? null : e.getParentCode();
        }
        return false;
    }

    /** 删除业务域：仍有子域或被 Issue 引用时拒绝，避免历史 Issue 丢失分拣依据；仓库绑定随域删除自然解绑 */
    @DeleteMapping("/domains/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id) {
        BizDomainEntity d = bizDomainRepository.findById(id).orElse(null);
        if (d == null) return ResponseEntity.notFound().build();

        long children = bizDomainRepository.findAll().stream()
                .filter(x -> d.getCode().equals(x.getParentCode())).count();
        if (children > 0) return bad("该业务域下仍有 " + children + " 个子业务域，请先删除或迁移子域");

        long issues = issueRepository.findAll().stream()
                .filter(i -> d.getCode().equals(i.getBizCode())).count();
        if (issues > 0) return bad("该业务域仍被 " + issues + " 个 Issue 引用，不可删除；如需停用请关闭「启用」开关");

        bizDomainRepository.delete(d);
        return ResponseEntity.ok(Map.<String, Object>of("deleted", true));
    }

    /** 分拣预演：录入 Issue 前就能看到「会分给谁、进哪个 Git」 */
    @GetMapping("/sort-preview")
    public Map<String, Object> preview(@RequestParam String title,
                                       @RequestParam(required = false) String desc,
                                       @RequestParam(required = false) String biz,
                                       @RequestParam(required = false) String code) {
        String sample = notBlank(code) ? code.trim() : "SAMPLE";
        return toMap(sortService.sort(sample, title, desc, biz));
    }

    /** 人工指定业务域重新分拣 */
    @PostMapping("/sort/{issueCode}")
    public ResponseEntity<Map<String, Object>> resort(@PathVariable String issueCode,
                                                      @RequestBody(required = false) Map<String, String> body) {
        IssueEntity issue = issueRepository.findByCode(issueCode);
        if (issue == null) return ResponseEntity.notFound().build();

        String biz = body == null ? null : body.get("bizCode");
        SortService.Result r = sortService.sort(issue.getCode(), issue.getTitle(), issue.getDescription(),
                notBlank(biz) ? biz : issue.getBiz());

        issue.setSortMethod(r.method());
        issue.setSortReason(r.reason());
        issue.setCandidateBiz(r.candidates().isEmpty() ? null
                : r.candidates().stream().map(SortService.Candidate::code).reduce((a, b) -> a + "," + b).orElse(null));
        if (r.resolved()) {
            issue.setBizCode(r.bizCode());
            issue.setBiz(r.bizName());
            issue.setProject(r.project());
            issue.setRepoUrl(r.repoUrl());
            issue.setBranch(r.branch());
            issue.setClientId(r.clientId());
            if (issue.getOwner() == null || issue.getOwner().isBlank()) issue.setOwner(r.owner());
        }
        issueRepository.save(issue);

        // 人工指定业务域重新分拣成功后，同样按提出人设置尝试自动启动
        String autoStarted = null;
        if (r.resolved()) {
            autoStarted = autoStartService.tryAutoStart(issue.getCode(), "人工分拣后自动启动");
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("saved", true);
        resp.put("autoStarted", autoStarted);
        resp.put("result", toMap(r));
        return ResponseEntity.ok(resp);
    }

    private Map<String, Object> toMap(SortService.Result r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("resolved", r.resolved());
        m.put("method", r.method());
        m.put("reason", r.reason());
        m.put("bizCode", r.bizCode());
        m.put("bizName", r.bizName());
        m.put("owner", r.owner());
        m.put("project", r.project());
        m.put("repoUrl", r.repoUrl());
        m.put("baselineBranch", r.baselineBranch());
        m.put("branch", r.branch());
        m.put("priority", r.priority());
        m.put("clientId", r.clientId());
        m.put("sensitiveLevel", r.sensitiveLevel());
        m.put("sensitiveRepo", r.sensitiveRepo());
        m.put("requiredBackend", r.requiredBackend());
        m.put("inheritedFrom", r.inheritedFrom());
        m.put("candidates", r.candidates());
        return m;
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private static ResponseEntity<Map<String, Object>> bad(String msg) {
        return ResponseEntity.badRequest().body(Map.<String, Object>of("message", msg));
    }
}
