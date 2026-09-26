package com.yonyong.talos.service;

import com.yonyong.talos.entity.AiCallLogEntity;
import com.yonyong.talos.repository.AiCallLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;

/** AI 调用日志：保存渲染后的 Prompt、模型、用量与耗时，服务端可观测 */
@Service
@RequiredArgsConstructor
public class AiLogService {

    private final AiCallLogRepository logRepository;

    public AiCallLogEntity record(String issueCode, String node, String backend, String model,
                                  String renderedPrompt, boolean missingVars, Long latencyMs,
                                  Long tokenUsed, BigDecimal cost, String clientId) {
        AiCallLogEntity e = new AiCallLogEntity();
        e.setIssueCode(issueCode);
        e.setNode(node);
        e.setBackend(backend);
        e.setModel(model);
        e.setRenderedPrompt(renderedPrompt);
        e.setMissingVars(missingVars);
        e.setLatencyMs(latencyMs);
        e.setTokenUsed(tokenUsed == null ? 0L : tokenUsed);
        e.setCost(cost == null ? BigDecimal.ZERO : cost);
        e.setClientId(clientId);
        return logRepository.save(e);
    }
}
