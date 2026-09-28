package com.yonyong.talos.controller;

import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/** 用户与角色 */
@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;

    @GetMapping
    public List<UserEntity> list(@RequestParam(required = false) String role) {
        List<UserEntity> all = userRepository.findAll();
        // 兼容旧数据：roles 空则回落单值 role
        for (UserEntity u : all) hydrateRoles(u);
        if (role == null || role.isBlank()) return all;
        String needle = role.trim().toLowerCase(Locale.ROOT);
        return all.stream()
                .filter(u -> rolesOf(u).stream().anyMatch(r -> r.equalsIgnoreCase(needle)))
                .collect(Collectors.toList());
    }

    /**
     * 绑定约束：用户绑定客户端后不可自行更换或解绑，
     * 只能由管理员在「客户端管理」页解除绑定后重新绑定（POST /api/clients/{clientId}/bound-users/{empNo}/unbind）。
     */
    @PostMapping
    public ResponseEntity<UserEntity> save(@RequestBody UserEntity user) {
        UserEntity existing = user.getId() != null
                ? userRepository.findById(user.getId()).orElse(null)
                : userRepository.findByEmpNo(user.getEmpNo());
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
        // 多角色：请求携带 roles 时以它为准，并同步主角色 role；未携带则保留
        if (user.getRoles() != null) {
            List<String> roles = normalizeRoles(user.getRoles());
            if (roles.isEmpty() && user.getRole() != null && !user.getRole().isBlank()) {
                roles = normalizeRoles(List.of(user.getRole()));
            }
            if (roles.isEmpty()) roles = List.of("guest");
            user.setRoles(roles);
            user.setRole(roles.get(0));
        } else if (existing != null) {
            hydrateRoles(existing);
            user.setRoles(existing.getRoles());
            user.setRole(existing.getRole());
        } else if (user.getRole() != null && !user.getRole().isBlank()) {
            List<String> roles = normalizeRoles(List.of(user.getRole()));
            user.setRoles(roles);
            user.setRole(roles.get(0));
        }
        UserEntity saved = userRepository.save(user);
        hydrateRoles(saved);
        return ResponseEntity.ok(saved);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        userRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("deleted", true));
    }

    /** roles 空时用单值 role 回填，保证前端始终拿到数组 */
    private static void hydrateRoles(UserEntity u) {
        if (u == null) return;
        List<String> roles = rolesOf(u);
        u.setRoles(roles);
        if (u.getRole() == null || u.getRole().isBlank()) {
            u.setRole(roles.isEmpty() ? "guest" : roles.get(0));
        }
    }

    private static List<String> rolesOf(UserEntity u) {
        if (u.getRoles() != null && !u.getRoles().isEmpty()) {
            return normalizeRoles(u.getRoles());
        }
        if (u.getRole() != null && !u.getRole().isBlank()) {
            return normalizeRoles(List.of(u.getRole()));
        }
        return new ArrayList<>(List.of("guest"));
    }

    private static List<String> normalizeRoles(List<String> raw) {
        return raw.stream()
                .filter(r -> r != null && !r.isBlank())
                .map(String::trim)
                .map(r -> r.toLowerCase(Locale.ROOT))
                .distinct()
                .collect(Collectors.toCollection(ArrayList::new));
    }
}
