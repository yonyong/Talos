package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 业务域：分拣的第一依据。
 * 承载「业务 → 业务/开发负责人 / 默认优先级 / 敏感等级」，
 * 替代原先散落在 AdmissionService 里的关键词硬编码。
 *
 * <p>支持层级：parentCode 为空表示一级业务域；子业务域未配置的字段
 * 沿父链向上继承（负责人、优先级、敏感等级、执行客户端），
 * 仓库同样在自身无绑定时向上查找父域。
 *
 * <p>工作流模板不在这里配置：Issue 是需求还是缺陷由录入时的诉求类型决定，
 * WorkflowService.start() 直接按 issue.type 选模板（REQ→需求工作流，BUG→缺陷工作流）。
 */
@Data
@Entity
@Table(name = "t_biz_domain", indexes = { @Index(name = "idx_biz_code", columnList = "code") })
public class BizDomainEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 业务编码，分拣命中后的落点标识；历史 Issue 保存 bizCode 快照 */
    @Column(unique = true, nullable = false, length = 32)
    private String code;

    /**
     * 本业务域绑定的仓库项目名（t_repo.project）；空 = 未绑定，沿父链向上继承。
     * 一个业务域只对应一个仓库，一个仓库可被多个业务域指向（绑定关系存在业务域侧）。
     */
    @Column(length = 128)
    private String repoProject;

    /** 父业务域编码；为空即一级业务域 */
    @Column(length = 32)
    private String parentCode;

    /** 业务名称，如「行情」 */
    @Column(nullable = false, length = 64)
    private String name;

    /** 命中关键词，逗号分隔；分拣时与 Issue 标题+描述做包含匹配 */
    @Column(length = 512)
    private String keywords;

    /**
     * 业务负责人：需求提出 / 验收侧，逗号分隔多人，书写顺序即优先级（第 1 人为主责）。
     * 子业务域留空时沿父链继承。
     */
    @Column(length = 256)
    private String bizOwners;

    /**
     * 开发负责人：承接 / 执行侧，逗号分隔多人，书写顺序即优先级；
     * 分拣默认承接人 = 链上第一个非空的第 1 顺位开发负责人。
     */
    @Column(length = 256)
    private String devOwners;

    @Column(length = 8)
    private String defaultPriority;

    /** 默认执行客户端，空 = 按责任人绑定的客户端派发 */
    @Column(length = 64)
    private String defaultClientId;

    /** 普通 / 敏感 / 核心；核心业务强制走私有化后端 */
    @Column(length = 16)
    private String sensitiveLevel;

    /** 响应时限（小时），用于超期告警 */
    private Integer slaHours;

    private Boolean enabled;

    @Column(length = 512)
    private String description;

    private LocalDateTime updatedAt;
}
