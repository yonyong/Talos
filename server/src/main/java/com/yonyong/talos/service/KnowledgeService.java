package com.yonyong.talos.service;

import com.yonyong.talos.entity.KbDocEntity;
import com.yonyong.talos.repository.KbDocRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 知识库检索：为准入判定与项目分拣提供召回。
 * 生产环境建议换为 pgvector 向量召回；此处用可运行的字面相似度打分做等价实现。
 */
@Service
@RequiredArgsConstructor
public class KnowledgeService {

    private final KbDocRepository kbDocRepository;

    /** 简单召回：按字符重合度打分（0~1） */
    public List<Hit> search(String query, int topN) {
        if (query == null || query.isBlank()) return List.of();
        Set<String> q = tokenize(query);
        return kbDocRepository.findByStatus("已索引").stream()
                .map(d -> new Hit(d, score(q, tokenize(d.getName() + " " + d.getCategory()))))
                .filter(h -> h.sim() > 0.05)
                .sorted(Comparator.comparingDouble(Hit::sim).reversed())
                .limit(topN)
                .collect(Collectors.toList());
    }

    private double score(Set<String> q, Set<String> d) {
        if (q.isEmpty() || d.isEmpty()) return 0d;
        Set<String> inter = new HashSet<>(q);
        inter.retainAll(d);
        return (double) inter.size() / (double) Math.max(q.size(), d.size());
    }

    private Set<String> tokenize(String s) {
        Set<String> out = new LinkedHashSet<>();
        String[] parts = s.toLowerCase().replaceAll("[^\\w\\u4e00-\\u9fa5]+", " ").split("\\s+");
        for (String p : parts) {
            if (p.length() >= 2) out.add(p);
            for (int i = 0; i + 2 <= p.length(); i++) out.add(p.substring(i, i + 2));
        }
        return out;
    }

    public record Hit(KbDocEntity doc, double sim) {}
}
