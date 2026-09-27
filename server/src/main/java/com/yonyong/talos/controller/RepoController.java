package com.yonyong.talos.controller;

import com.yonyong.talos.entity.BizDomainEntity;
import com.yonyong.talos.entity.RepoEntity;
import com.yonyong.talos.repository.BizDomainRepository;
import com.yonyong.talos.repository.RepoRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 仓库管理：仓库承载 git 地址、分支策略、构建/测试命令与安全约束。
 * 与业务域是「一仓多域」：绑定关系存在业务域侧（t_biz_domain.repoProject），
 * 一个仓库可被多个业务域指向，一个业务域只对应一个仓库。
 */
@RestController
@RequestMapping("/api/repos")
@RequiredArgsConstructor
public class RepoController {

    private final RepoRepository repoRepository;
    private final BizDomainRepository bizDomainRepository;

    @GetMapping
    public List<RepoEntity> list() { return repoRepository.findAll(); }

    @PostMapping
    public ResponseEntity<Map<String, Object>> save(@RequestBody RepoEntity in) {
        if (!notBlank(in.getProject())) return bad("项目名不能为空");
        if (!notBlank(in.getRepoUrl())) return bad("Git 地址不能为空");
        String project = in.getProject().trim();

        RepoEntity exist = in.getId() != null
                ? repoRepository.findById(in.getId()).orElse(null)
                : repoRepository.findByProject(project);
        RepoEntity holder = repoRepository.findByProject(project);
        if (holder != null && (exist == null || !holder.getId().equals(exist.getId()))) {
            return bad("项目名 " + project + " 已存在");
        }
        String oldProject = exist == null ? null : exist.getProject();

        // 归属业务域：bizCodes 字段非 null 时全量重设（null = 不动绑定，如启停开关）
        List<String> codes = in.getBizCodes() == null ? null
                : in.getBizCodes().stream().filter(c -> c != null && !c.isBlank()).map(String::trim).distinct().toList();
        if (codes != null) {
            for (String c : codes) {
                BizDomainEntity d = bizDomainRepository.findByCode(c);
                if (d == null) return bad("业务域 " + c + " 不存在，请先在「业务管理」中创建");
                String bound = d.getRepoProject();
                boolean mine = bound == null || bound.isBlank()
                        || bound.equals(project) || bound.equals(oldProject);
                if (!mine) {
                    return bad("业务域 " + c + " 已绑定仓库 " + bound + "（一个业务域只对应一个仓库）");
                }
            }
        }

        boolean created = exist == null;
        RepoEntity t = created ? new RepoEntity() : exist;
        t.setProject(project);
        t.setRepoUrl(in.getRepoUrl().trim());
        if (in.getBaselineBranch() != null) t.setBaselineBranch(in.getBaselineBranch());
        if (in.getBranchPrefix() != null) t.setBranchPrefix(in.getBranchPrefix());
        if (in.getLanguage() != null) t.setLanguage(in.getLanguage());
        if (in.getBuildCmd() != null) t.setBuildCmd(in.getBuildCmd());
        if (in.getTestCmd() != null) t.setTestCmd(in.getTestCmd());
        if (in.getSensitive() != null) t.setSensitive(in.getSensitive());
        if (in.getRequiredBackend() != null) t.setRequiredBackend(notBlank(in.getRequiredBackend()) ? in.getRequiredBackend() : null);
        if (in.getDefaultClientId() != null) t.setDefaultClientId(in.getDefaultClientId());
        if (in.getDescription() != null) t.setDescription(in.getDescription());
        if (created) t.setEnabled(in.getEnabled() == null ? Boolean.TRUE : in.getEnabled());
        else if (in.getEnabled() != null) t.setEnabled(in.getEnabled());
        t.setUpdatedAt(LocalDateTime.now());
        repoRepository.save(t);

        // 全量重设绑定：勾选的指向本仓库，原先指向本仓库但未勾选的解绑（编辑改项目名时一并迁移）
        if (codes != null) {
            Set<String> want = new HashSet<>(codes);
            for (BizDomainEntity d : bizDomainRepository.findAll()) {
                String bound = d.getRepoProject();
                boolean was = oldProject != null && oldProject.equals(bound);
                boolean now = want.contains(d.getCode());
                if (now) {
                    if (!project.equals(bound)) {
                        d.setRepoProject(project);
                        d.setUpdatedAt(LocalDateTime.now());
                        bizDomainRepository.save(d);
                    }
                } else if (was) {
                    d.setRepoProject(null);
                    d.setUpdatedAt(LocalDateTime.now());
                    bizDomainRepository.save(d);
                }
            }
        }

        return ResponseEntity.ok(Map.<String, Object>of("saved", true, "id", t.getId(), "created", created));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id) {
        RepoEntity r = repoRepository.findById(id).orElse(null);
        if (r == null) return ResponseEntity.notFound().build();
        // 解绑所有指向本仓库的业务域，再删除；业务域回到「沿父链继承 / 未配置」状态
        for (BizDomainEntity d : bizDomainRepository.findByRepoProject(r.getProject())) {
            d.setRepoProject(null);
            d.setUpdatedAt(LocalDateTime.now());
            bizDomainRepository.save(d);
        }
        repoRepository.delete(r);
        return ResponseEntity.ok(Map.<String, Object>of("deleted", true));
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private static ResponseEntity<Map<String, Object>> bad(String msg) {
        return ResponseEntity.badRequest().body(Map.<String, Object>of("message", msg));
    }
}
