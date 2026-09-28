package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

/**
 * 用户个人的 Coding Agent 配置：一个用户可配多个，sortOrder 即优先级（越小越优先）。
 *
 * 与 t_agent_config（GLOBAL/clientId，管理员维护）叠加：
 * 客户端生效顺序 = GLOBAL 默认 → clientId 覆盖 → 本表按 sortOrder 逐条覆盖同 backend 字段，
 * 用户新增的管理端没有的 backend 会作为新条目下发；enabled=false 的条目不下发覆盖。
 *
 * <p>用户关联统一用 {@code user_id}（t_user.id）；旧版 emp_no 关联由 DataInitializer 一次性迁移。</p>
 */
@Data
@Entity
@Table(name = "t_user_agent", indexes = { @Index(name = "idx_user_agent_user", columnList = "user_id") })
public class UserAgentEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 归属用户 id（t_user.id）。DDL 不加 NOT NULL：老库经 Hibernate update 加列时已有存量行，
     * 由 DataInitializer 迁移回填，业务层保证非空。
     */
    @Column(name = "user_id")
    private Long userId;

    /** 后端标识：claude / cursor / codex / codebuddy… */
    @Column(length = 32)
    private String backend;

    @Column(length = 256)
    private String execPath;

    @Column(length = 256)
    private String argsTemplate;

    @Column(length = 256)
    private String workDir;

    @Column(length = 512)
    private String envVars;

    /** 模型（覆盖管理端下发值，留空沿用） */
    @Column(length = 64)
    private String model;

    /** 单日 token 限额（覆盖管理端下发值，空 = 不覆盖） */
    private Long tokenLimit;

    /** false = 该条停用，不下发覆盖（沿用管理端配置） */
    private Boolean enabled;

    /** 优先级，从 0 递增；拖拽排序后整表重写 */
    private Integer sortOrder;
}
