package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 工作流实例：一个 Issue 的一次执行 */
@Data
@Entity
@Table(name = "t_wf_instance", indexes = { @Index(name = "idx_wfi_code", columnList = "instanceCode") })
public class WorkflowInstance {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, length = 32)
    private String instanceCode;

    @Column(length = 32)
    private String issueCode;

    @Column(length = 16)
    private String templateCode;

    /**
     * 启动时固化的图定义快照（nodes + edges）。
     * 模板后续被编辑不影响已在跑的实例，回退边判定也依赖它。
     */
    @Column(columnDefinition = "TEXT")
    private String definitionJson;

    /** 已完成终结的节点数（图结构下 currentStep 不再等于「当前步骤」） */
    private Integer currentStep;
    private Integer totalSteps;

    /** 回退重做轮次，从 1 开始；超过上限则实例阻塞待人工介入 */
    private Integer round;

    /** pending / running / blocked / done / failed / cancelled */
    @Column(length = 24)
    private String status;

    @Column(length = 64)
    private String clientId;

    private LocalDateTime startedAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        this.startedAt = LocalDateTime.now();
        this.updatedAt = this.startedAt;
        if (this.status == null) this.status = "pending";
        if (this.round == null) this.round = 1;
    }

    @PreUpdate
    public void preUpdate() { this.updatedAt = LocalDateTime.now(); }
}
