package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 任务节点：下发给客户端执行的最小单元 */
@Data
@Entity
@Table(name = "t_task_node")
public class TaskNodeEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 32)
    private String instanceCode;

    private Integer step;

    @Column(length = 64)
    private String name;

    /** git / doc / code / test / rev */
    @Column(length = 16)
    private String kind;

    /** 服务端 / 客户端 */
    @Column(length = 16)
    private String execLocation;

    @Column(length = 32)
    private String backend;

    @Column(length = 128)
    private String promptTemplate;

    @Column(length = 64)
    private String gate;

    /**
     * 闸门判定结论：pass / blocked / null（无闸门或未判定）。
     * 条件边据此选路，与执行结果 status 分离，避免「执行成功但评审驳回」无法表达。
     */
    @Column(length = 16)
    private String gateResult;

    /** 实例内第几轮执行（回退边重做时递增），从 1 开始 */
    private Integer round;

    /** waiting / dispatched / running / success / failed / skipped / cancelled */
    @Column(length = 24)
    private String status;

    @Column(columnDefinition = "TEXT")
    private String execLog;

    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
