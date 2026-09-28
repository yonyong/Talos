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

    /**
     * 登录邮箱，也是全系统的用户身份标识（个人配置、接口定位、显示均以邮箱为准；工号已废弃删除）。
     * 控制台以「邮箱 + 邮件授权码」登录，授权码发往此地址。
     * 为空表示该用户暂不可登录（由管理员在「用户管理」页维护）。
     * 唯一性在 UserController / AuthService 层校验（不加 DB 唯一约束，避免老库全 NULL 时的迁移风险）。
     */
    @Column(length = 128)
    private String email;

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
