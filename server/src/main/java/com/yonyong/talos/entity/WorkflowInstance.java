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

    private Integer currentStep;
    private Integer totalSteps;

    /** pending / running / blocked / done / failed */
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
    }

    @PreUpdate
    public void preUpdate() { this.updatedAt = LocalDateTime.now(); }
}
