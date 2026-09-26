package com.yonyong.talos.controller;

import com.yonyong.talos.entity.DocEntity;
import com.yonyong.talos.repository.DocRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 过程文档：客户端生成后回传，服务端集中可见 */
@RestController
@RequestMapping("/api/docs")
@RequiredArgsConstructor
public class DocController {

    private final DocRepository docRepository;

    @GetMapping
    public List<DocEntity> list(@RequestParam(required = false) String issueCode,
                                @RequestParam(required = false) String kind) {
        if (issueCode != null) return docRepository.findByIssueCode(issueCode);
        if (kind != null) return docRepository.findByKind(kind);
        return docRepository.findAll();
    }

    @PostMapping
    public ResponseEntity<DocEntity> upload(@RequestBody DocEntity doc) {
        return ResponseEntity.ok(docRepository.save(doc));
    }
}
