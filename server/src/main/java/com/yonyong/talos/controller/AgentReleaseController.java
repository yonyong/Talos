package com.yonyong.talos.controller;

import com.yonyong.talos.service.AgentReleaseService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 客户端安装包发布源。
 *
 * 控制台「接入指南」页在此上传 / 维护版本并指定当前生效版；
 * 「客户端」页与「下载」页的版本信息、静默升级取包也来自这里，
 * 避免出现「页面写 1.4.2、实际发的是别的版本」这类对不上的情况。
 */
@RestController
@RequestMapping("/api/agent/release")
@RequiredArgsConstructor
public class AgentReleaseController {

    private final AgentReleaseService releaseService;

    /** 当前发布版元数据；未上传客户端包时 available=false（下载页 / 客户端页用） */
    @GetMapping
    public Map<String, Object> meta() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("releaseDir", releaseService.releaseDir());
        AgentReleaseService.Release r = releaseService.latest();
        if (r == null) {
            m.put("available", false);
            m.put("hint", "尚未上传客户端安装包。可在「接入指南」页上传，或把 talos-agent-<版本>.jar 放进发布目录。");
            return m;
        }
        m.put("available", true);
        putRelease(m, r);
        return m;
    }

    /** 版本库全量列表：当前生效版 + 历史版本（接入指南页用） */
    @GetMapping("/list")
    public Map<String, Object> list() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("releaseDir", releaseService.releaseDir());
        AgentReleaseService.Release current = releaseService.latest();
        List<AgentReleaseService.Release> all = releaseService.listAll();
        m.put("available", !all.isEmpty());
        m.put("current", current == null ? null : item(current, true));
        List<Map<String, Object>> versions = new ArrayList<>();
        for (AgentReleaseService.Release r : all) {
            versions.add(item(r, current != null && r.version().equals(current.version())));
        }
        m.put("versions", versions);
        return m;
    }

    /** 上传安装包（文件名需形如 talos-agent-<版本>.jar / .zip），成功后立即生效 */
    @PostMapping("/upload")
    public Map<String, Object> upload(@RequestParam("file") MultipartFile file) throws java.io.IOException {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("请选择要上传的安装包文件");
        releaseService.upload(file.getInputStream(), file.getOriginalFilename());
        return list();
    }

    /** 指定当前生效版本（可回退到历史版本） */
    @PostMapping("/activate")
    public Map<String, Object> activate(@RequestBody Map<String, String> body) {
        releaseService.activate(body == null ? null : body.get("version"));
        return list();
    }

    /** 删除某个安装包；若删除的是当前生效版则自动回落到最高版本 */
    @DeleteMapping("/file")
    public Map<String, Object> deleteFile(@RequestParam("name") String name) {
        releaseService.deleteFile(name);
        return list();
    }

    /** 重新扫描发布目录（手工放入新包后点一下即可生效，不必重启服务端） */
    @PostMapping("/refresh")
    public Map<String, Object> refresh() {
        releaseService.invalidate();
        return meta();
    }

    /** 安装包下载流；带 version 参数可下载历史版本，缺省为当前生效版 */
    @GetMapping("/download")
    public ResponseEntity<Resource> download(@RequestParam(value = "version", required = false) String version) {
        AgentReleaseService.Release r = (version == null || version.isBlank())
                ? releaseService.latest()
                : releaseService.byVersion(version);
        if (r == null) return ResponseEntity.notFound().build();
        Path path = Paths.get(r.path());
        if (!Files.isRegularFile(path)) return ResponseEntity.notFound().build();

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + r.fileName() + "\"")
                .header("X-Talos-Agent-Version", r.version())
                .header("X-Talos-Sha256", r.sha256())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(r.size())
                .body(new FileSystemResource(path));
    }

    private void putRelease(Map<String, Object> m, AgentReleaseService.Release r) {
        m.put("version", r.version());
        m.put("fileName", r.fileName());
        m.put("size", r.size());
        m.put("sha256", r.sha256());
        m.put("updatedAt", r.updatedAt());
        m.put("downloadUrl", r.downloadUrl());
    }

    private Map<String, Object> item(AgentReleaseService.Release r, boolean current) {
        Map<String, Object> i = new LinkedHashMap<>();
        putRelease(i, r);
        i.put("current", current);
        return i;
    }
}
