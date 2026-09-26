package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 工作流模板：需求 / 缺陷两套标准链路 */
@Data
@Entity
@Table(name = "t_wf_template")
public class WorkflowTemplate {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** REQ / BUG */
    @Column(unique = true, length = 16)
    private String code;

    @Column(length = 64)
    private String name;

    private Integer nodeCount;

    /** 节点定义 JSON：step/name/kind/execLocation/backend/promptTemplate/gate */
    @Column(columnDefinition = "TEXT")
    private String definitionJson;

    private Boolean enabled;

    private LocalDateTime updatedAt;
}
