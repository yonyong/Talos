package com.yonyong.talos.controller;

import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.UserRepository;
import com.yonyong.talos.service.AuthService;
import com.yonyong.talos.service.AuthSessionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 用户与角色 */
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;
    private final AuthSessionService sessionService;

    @GetMapping
    public List<UserEntity> list(@RequestParam(required = false) String role) {
        return role == null ? userRepository.findAll() : userRepository.findByRole(role);
    }

    /**
     * 绑定约束：用户绑定客户端后不可自行更换或解绑，
     * 只能由管理员在「客户端管理」页解除绑定后重新绑定（POST /api/clients/{clientId}/bound-users/{userId}/unbind）。
     */
    @PostMapping
    public ResponseEntity<UserEntity> save(@RequestBody UserEntity user) {
        UserEntity existing = user.getId() != null
                ? userRepository.findById(user.getId()).orElse(null)
                : null;
        if (existing != null && existing.getClientId() != null && !existing.getClientId().isBlank()) {
            String incoming = user.getClientId();
            if (incoming == null || incoming.isBlank() || !incoming.equals(existing.getClientId())) {
                throw new IllegalStateException("用户 " + existing.getName() + " 已绑定客户端 "
                        + existing.getClientId() + "，不可更改；如需更换请由管理员在「客户端管理」页解除绑定");
            }
        }
        // 业务域多值：请求携带 bizCodes（含空数组）时以它为准并镜像回 bizDomain 旧列；
        // 未携带（如仅改客户端绑定）则保留原有 bizDomain / bizCodes，避免误清空。
        if (user.getBizCodes() != null) {
            List<String> codes = user.getBizCodes().stream()
                    .filter(c -> c != null && !c.isBlank())
                    .map(String::trim)
                    .distinct()
                    .toList();
            user.setBizCodes(codes);
            user.setBizDomain(codes.isEmpty() ? "" : String.join(",", codes));
        } else if (existing != null) {
            user.setBizCodes(existing.getBizCodes());
            user.setBizDomain(existing.getBizDomain());
        }

        // 登录邮箱：null = 请求未携带（保留原值，便于只改绑定关系这类局部更新），
        // 空串 = 显式清空（该用户随即无法登录）。
        if (user.getEmail() == null && existing != null) {
            user.setEmail(existing.getEmail());
        }
        applyEmail(user, existing);

        return ResponseEntity.ok(userRepository.save(user));
    }

    /**
     * 邮箱是登录身份，必须唯一且格式合法：
     * 邮箱唯一性在业务层校验（实体上不加 DB 唯一约束，避免老库全 NULL 时的迁移风险）。
     */
    private void applyEmail(UserEntity user, UserEntity existing) {
        String raw = user.getEmail();
        if (raw == null || raw.isBlank()) {
            user.setEmail(null);
            return;
        }
        String email = AuthService.normalize(raw);
        if (!AuthService.validEmail(email)) {
            throw new IllegalArgumentException("邮箱格式不正确：" + raw.trim());
        }
        Long selfId = existing == null ? null : existing.getId();
        UserEntity other = selfId == null
                ? userRepository.findFirstByEmailIgnoreCase(email)
                : userRepository.findFirstByEmailIgnoreCaseAndIdNot(email, selfId);
        if (other != null) {
            throw new IllegalStateException("邮箱 " + email + " 已被用户 " + other.getName()
                    + " 占用，登录身份不可重复");
        }
        user.setEmail(email);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        // 用户一删，其已签发但仍在有效期内的会话必须立刻作废
        int revoked = sessionService.revokeUser(id);
        userRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("deleted", true, "sessionsRevoked", revoked));
    }
}
