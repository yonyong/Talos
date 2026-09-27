package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 代码仓库：承载 git 地址、分支策略、构建/测试命令与安全约束。
 * 仓库与业务域是「一仓多域」：绑定关系存在业务域侧（t_biz_domain.repoProject），
 * 一个仓库可服务多个业务域，一个业务域只指向一个仓库。
 */
@Data
@Entity
@Table(name = "t_repo", indexes = { @Index(name = "idx_repo_project", columnList = "project") })
public class RepoEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 项目名，如 quote-service */
    @Column(unique = true, nullable = false, length = 128)
    private String project;

    /** @deprecated 旧版 1:1 绑定字段，仅用于存量库迁移到 t_biz_domain.repoProject，新代码勿读写 */
    @Deprecated
    @Column(length = 32)
    private String bizCode;

    /** 保存请求透传的「归属业务域编码」列表；仅编辑仓库时使用，不落库 */
    @Transient
    private List<String> bizCodes;

    @Column(nullable = false, length = 256)
    private String repoUrl;

    /** 基线分支，拉取与合并的目标分支 */
    @Column(length = 64)
    private String baselineBranch;

    /** 工作分支前缀，启动工作流时拼 issue.code 生成实际分支 */
    @Column(length = 32)
    private String branchPrefix;

    @Column(length = 32)
    private String language;

    @Column(length = 256)
    private String buildCmd;

    @Column(length = 256)
    private String testCmd;

    /** 敏感仓库：仅允许内网客户端执行 */
    private Boolean sensitive;

    /** 强制后端（如 codebuddy），空 = 不限制 */
    @Column(length = 32)
    private String requiredBackend;

    @Column(length = 64)
    private String defaultClientId;

    private Boolean enabled;

    @Column(length = 512)
    private String description;

    private LocalDateTime updatedAt;
}
