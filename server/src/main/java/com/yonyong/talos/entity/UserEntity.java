package com.yonyong.talos.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.util.List;

/** 用户与角色：RBAC 按业务域鉴权 */
@Data
@Entity
@Table(name = "t_user")
public class UserEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 64)
    private String name;

    @Column(unique = true, length = 32)
    private String empNo;

    /** admin / pm / lead / dev / qa / guest */
    @Column(length = 16)
    private String role;

    /**
     * 归属业务域编码列表（多值），与仓库的 bizCodes 一致。
     * 用逗号分隔持久化在单字段中；bizDomain 旧列为兼容展示保留。
     * 默认 null：JSON 请求未携带 bizCodes 时（如仅改客户端绑定）保留旧值。
     */
    @Convert(converter = StringListConverter.class)
    @Column(length = 512)
    private List<String> bizCodes;

    /** @deprecated 旧版单值业务域（存的是名称）；新链路以 bizCodes 为准，仅作只读兜底 */
    @Deprecated
    @Column(length = 128)
    private String bizDomain;

    @Column(length = 64)
    private String clientId;
}
