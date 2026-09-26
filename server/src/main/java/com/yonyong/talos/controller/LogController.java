package com.yonyong.talos.controller;

import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.repository.AiCallLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** AI 调用日志：渲染后的 Prompt、模型、用量与耗时 */
@RestController
@RequestMapping("/api/logs")
@RequiredArgsConstructor
public class LogController {

    private final AiCallLogRepository logRepository;

    @GetMapping
    public List<AiCallLogEntity> list(@RequestParam(required = false) String issueCode) {
        return issueCode == null ? logRepository.findTop100ByOrderByCreatedAtDesc() : logRepository.findByIssueCode(issueCode);
    }
}
