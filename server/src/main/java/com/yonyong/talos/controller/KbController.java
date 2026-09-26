package com.yonyong.talos.controller;

import com.yonyong.talos.entity.KbDocEntity;
import com.yonyong.talos.repository.KbDocRepository;
import com.yonyong.talos.service.KnowledgeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 知识库：文档索引与检索测试 */
@RestController
@RequestMapping("/api/kb")
@RequiredArgsConstructor
public class KbController {

    private final KbDocRepository kbDocRepository;
    private final KnowledgeService knowledgeService;

    @GetMapping
    public List<KbDocEntity> list() { return kbDocRepository.findAll(); }

    @GetMapping("/{name}")
    public ResponseEntity<KbDocEntity> get(@PathVariable String name) {
        KbDocEntity d = kbDocRepository.findByName(name);
        return d == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(d);
    }

    @PostMapping
    public ResponseEntity<KbDocEntity> add(@RequestBody KbDocEntity doc) {
        doc.setStatus(doc.getStatus() == null ? "索引中" : doc.getStatus());
        doc.setIndexedAt(java.time.LocalDateTime.now());
        return ResponseEntity.ok(kbDocRepository.save(doc));
    }

    /** 检索测试：模拟准入判定时的知识召回 */
    @GetMapping("/search")
    public List<Map<String, Object>> search(@RequestParam String q, @RequestParam(defaultValue = "5") int topN) {
        return knowledgeService.search(q, topN).stream()
                .map(h -> Map.<String, Object>of(
                        "doc", h.doc().getName(),
                        "category", h.doc().getCategory(),
                        "sim", String.format("%.2f", h.sim())))
                .toList();
    }
}
