package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/** 客户端：研发终端注册信息与在线状态 */
@Data
@Entity
@Table(name = "t_client", indexes = { @Index(name = "idx_client_id", columnList = "clientId") })
public class ClientEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false, length = 64)
    private String clientId;

    @Column(length = 64)
    private String owner;

    @Column(length = 64)
    private String ip;

    @Column(length = 16)
    private String version;

    /** ONLINE / BUSY / OFFLINE */
    @Column(length = 16)
    private String status;

    private LocalDateTime lastHeartbeat;

    /** 已配置的 Coding Agent 概览，如 CC,Cu,CB */
    @Column(length = 128)
    private String agentSummary;

    /** 当前 gRPC stream 标识，用于服务端定向推送 */
    @Column(length = 64)
    private String sessionId;
}
