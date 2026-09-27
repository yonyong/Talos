package com.yonyong.talos.controller;

import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.UserRepository;
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

    @GetMapping
    public List<UserEntity> list(@RequestParam(required = false) String role) {
        return role == null ? userRepository.findAll() : userRepository.findByRole(role);
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
        return ResponseEntity.ok(userRepository.save(user));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        userRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("deleted", true));
    }
}
