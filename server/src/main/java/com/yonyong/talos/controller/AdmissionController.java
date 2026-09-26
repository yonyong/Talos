package com.yonyong.talos.controller;

import com.yonyong.talos.entity.IssueEntity;
import com.yonyong.talos.repository.IssueRepository;
import com.yonyong.talos.service.AdmissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 准入判定队列与人工覆写 */
@RestController
@RequestMapping("/api/admissions")
@RequiredArgsConstructor
public class AdmissionController {

    private final IssueRepository issueRepository;
    private final AdmissionService admissionService;

    @GetMapping
    public List<IssueEntity> queue() {
        return issueRepository.findAll().stream()
                .filter(i -> i.getAdmissionResult() == null || "pending".equals(i.getAdmissionResult()))
                .toList();
    }

    @PostMapping("/{code}/judge")
    public ResponseEntity<IssueEntity> judge(@PathVariable String code) {
        return ResponseEntity.ok(admissionService.judge(code));
    }

    @PostMapping("/{code}/override")
    public ResponseEntity<IssueEntity> override(@PathVariable String code, @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(admissionService.override(code, body.get("result"), body.getOrDefault("operator", "system")));
    }
}
