package com.yonyong.talos.controller;

import com.yonyong.talos.entity.RolePermissionEntity;
import com.yonyong.talos.repository.RolePermissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 角色权限矩阵 */
@RestController
@RequestMapping("/api/roles")
@RequiredArgsConstructor
public class RoleController {

    private final RolePermissionRepository rolePermissionRepository;

    @GetMapping
    public List<RolePermissionEntity> list() { return rolePermissionRepository.findAll(); }

    @PostMapping
    public ResponseEntity<RolePermissionEntity> save(@RequestBody RolePermissionEntity rp) {
        RolePermissionEntity existing = rolePermissionRepository.findAll().stream()
                .filter(x -> x.getRole().equals(rp.getRole()) && x.getCapability().equals(rp.getCapability()))
                .findFirst().orElse(null);
        if (existing != null) {
            existing.setLevel(rp.getLevel());
            return ResponseEntity.ok(rolePermissionRepository.save(existing));
        }
        return ResponseEntity.ok(rolePermissionRepository.save(rp));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id) {
        rolePermissionRepository.deleteById(id);
        return ResponseEntity.ok().build();
    }
}
