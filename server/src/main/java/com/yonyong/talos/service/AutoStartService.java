package com.yonyong.talos.service;

import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.entity.UserSettingEntity;
import com.yonyong.talos.entity.WorkflowInstance;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.repository.UserSettingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 工作流自动启动：准入通过 + 分拣成功 + 客户端在线 → 免人工点击直接 start。
 *
 * 触发点有三处：
 * 1) 准入判定完成（AdmissionService.judge，录入即判）；
 * 2) 人工指定业务域重新分拣成功（BizController.resort）；
 * 3) 客户端上线补启（AgentGrpcService.register）——自动启动时客户端离线会留在分拣中，
 *    待其上线后扫描补启，避免流水线因离线而断链。
 *
 * 开关归属：按 Issue 提出人（reporter，兜底 owner）姓名反查工号取其个人设置；
 * null 视为自动（缺省自动执行），false 才需要人工确认。查不到人也视为自动（fail-open
 * 与准入 fail-safe 不冲突：启动门禁本身仍有准入/仓库/实例三道硬校验兜底）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AutoStartService {

    private final IssueRepository issueRepository;
    private final UserRepository userRepository;
    private final UserSettingRepository userSettingRepository;
    private final ClientRegistry clientRegistry;
    private final WorkflowService workflowService;

    /** 提出人的个人设置是否允许自动启动（null = 缺省自动） */
    public boolean enabledFor(IssueEntity issue) {
        UserEntity u = userByName(issue.getReporter());
        if (u == null) u = userByName(issue.getOwner());
        if (u == null) return true;
        UserSettingEntity s = userSettingRepository.findByEmpNo(u.getEmpNo());
        return s == null || !Boolean.FALSE.equals(s.getAutoStart());
    }

    /**
     * 尝试自动启动一条 Issue 的工作流。
     * 任何前置不满足都静默跳过（留原状态），绝不抛异常影响调用方主流程。
     *
     * @return 启动成功返回实例号；未启动返回 null
     */
    public String tryAutoStart(String issueCode, String trigger) {
        try {
            IssueEntity issue = issueRepository.findByCode(issueCode);
            if (issue == null) return null;
            if (!"admit".equals(issue.getAdmissionResult())) return null;
            if (issue.getRepoUrl() == null || issue.getRepoUrl().isBlank()) return null;
            String st = issue.getStatus();
            if ("running".equals(st) || "closed".equals(st) || "done".equals(st)) return null;
            if (workflowService.latestRunning(issueCode) != null) return null;
            if (!enabledFor(issue)) {
                log.info("自动启动跳过（提出人已关闭自动执行）: {} · {}", issueCode, trigger);
                return null;
            }
            String clientId = issue.getClientId();
            if (clientId == null || clientId.isBlank() || !clientRegistry.isOnline(clientId)) {
                log.info("自动启动暂缓（客户端离线或未绑定，待上线补启）: {} · client={}", issueCode, clientId);
                return null;
            }
            WorkflowInstance inst = workflowService.start(issueCode);
            log.info("工作流自动启动: {} · {} · client={}", issueCode, trigger, clientId);
            return inst.getInstanceCode();
        } catch (Exception e) {
            // 自动启动失败不能影响准入/分拣主流程，留人工兜底
            log.warn("自动启动失败，留待人工处理: {} · {}", issueCode, e.getMessage());
            return null;
        }
    }

    /** 客户端上线补启：扫描该客户端名下「准入通过且已分拣到仓库」的待启动 Issue */
    public int startPendingForClient(String clientId) {
        if (clientId == null || clientId.isBlank()) return 0;
        int started = 0;
        for (String status : List.of("sorting", "admitted")) {
            for (IssueEntity issue : issueRepository.findByStatus(status)) {
                if (!clientId.equals(issue.getClientId())) continue;
                if (tryAutoStart(issue.getCode(), "客户端上线补启") != null) started++;
            }
        }
        return started;
    }

    private UserEntity userByName(String name) {
        if (name == null || name.isBlank()) return null;
        return userRepository.findFirstByName(name);
    }
}
