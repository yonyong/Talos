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

    /**
     * 主角色（兼容旧字段）= roles 的第一项。
     * 新链路以 {@link #roles} 为准；读写时由 UserController 同步。
     */
    @Column(length = 16)
    private String role;

    /**
     * 用户拥有的全部角色（多值）：admin / pm / lead / dev / qa / guest。
     * 逗号分隔持久化；工作台按「当前激活角色」展示，激活角色必须 ∈ roles。
     * 默认 null：请求未携带 roles 时保留旧值。
     */
    @Convert(converter = StringListConverter.class)
    @Column(length = 128)
    private List<String> roles;

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
