package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 用户个人设置：Git 凭据 + 本机工具链（工作目录 / Maven）。
 *
 * 与 t_agent_config（scope=GLOBAL/clientId，管理员维护）不同，这张表由用户自己在
 * 设置面板维护，键为用户 id（t_user.id，工号已废弃）；Coding Agent 多条配置见 t_user_agent。
 * 下发合并顺序：GLOBAL 默认 → clientId 覆盖 → 个人层。
 * Git Token 只存服务端，经 ConfigPush 的 git 段下发给该用户绑定的客户端，接口永不回显明文。
 */
@Data
@Entity
@Table(name = "t_user_setting")
public class UserSettingEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 归属用户 id（t_user.id），唯一键。DDL 不加 NOT NULL：老库迁移回填由 DataInitializer 完成，
     * 业务层保证非空。唯一约束对 NULL 不生效（H2/PG 语义），老库存量 NULL 行不会卡建索引。
     */
    @Column(name = "user_id", unique = true)
    private Long userId;

    /** 客户端工作区目录：非空时优先于客户端 agent.yml 的 workspace */
    @Column(length = 256)
    private String workDir;

    /** 本机 Maven 安装目录：客户端执行 Coding Agent CLI 时把其 bin 前置到 PATH */
    @Column(length = 256)
    private String mavenHome;

    /** Git 访问令牌（https clone/fetch/push 鉴权用） */
    @Column(length = 256)
    private String gitToken;

    /** git user.name，客户端 clone 后写入仓库级配置 */
    @Column(length = 64)
    private String gitUserName;

    /** git user.email */
    @Column(length = 128)
    private String gitUserEmail;

    /** Git 测试用的仓库地址（设置面板「测试仓库地址」的持久化值，缺省时前端取第一个启用仓库） */
    @Column(length = 512)
    private String gitTestRepoUrl;

    /**
     * 工作流自动执行开关：null / true = 准入通过且分拣成功后自动启动工作流（缺省自动）；
     * false = 停在分拣中，由人工在 Issue 详情点击「启动工作流」确认后再执行。
     * 判定归属：优先按提出人（reporter）姓名反查用户取其设置，查不到人时视为自动。
     */
    @Column
    private Boolean autoStart;

    private LocalDateTime updatedAt;
}
