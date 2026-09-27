package com.yonyong.talos.service;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;
import java.util.UUID;

/**
 * 文档落盘：原始材料（截图、日志、需求稿等）按 Issue 分目录存放，
 * 数据库只保留相对路径，便于迁移与备份。
 */
@Service
public class DocStorageService {

    private final Path root;

    public DocStorageService(@Value("${talos.doc.dir:./data/docs}") String dir) {
        this.root = Paths.get(dir).toAbsolutePath().normalize();
    }

    @PostConstruct
    public void init() throws IOException {
        Files.createDirectories(root);
    }

    /**
     * 写入文件，返回相对根目录的路径（始终使用 / 分隔，便于跨平台）。
     *
     * @param issueCode 归属 Issue，作为一级目录
     * @param filename  原始文件名（会做安全清洗）
     */
    public String save(String issueCode, String filename, byte[] bytes) throws IOException {
        String dir = safeDir(issueCode);
        Path folder = root.resolve(dir);
        Files.createDirectories(folder);
        String safe = safeName(filename);
        Path target = folder.resolve(UUID.randomUUID().toString().substring(0, 8) + "-" + safe);
        Files.write(target, bytes);
        return dir + "/" + target.getFileName().toString();
    }

    /** 解析落盘文件：路径越界或文件不存在时返回空 */
    public Optional<Path> resolve(String relative) {
        if (relative == null || relative.isBlank()) return Optional.empty();
        try {
            Path p = root.resolve(relative).normalize();
            if (!p.startsWith(root)) return Optional.empty();
            return Files.isRegularFile(p) ? Optional.of(p) : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    public byte[] read(String relative) throws IOException {
        Optional<Path> p = resolve(relative);
        if (p.isEmpty()) throw new IOException("文件不存在: " + relative);
        return Files.readAllBytes(p.get());
    }

    public void delete(String relative) {
        if (relative == null || relative.isBlank()) return;
        try {
            Optional<Path> p = resolve(relative);
            if (p.isPresent()) Files.deleteIfExists(p.get());
        } catch (IOException ignored) {
            // 删不掉不影响数据库记录清理
        }
    }

    /** 目录名：只保留字母数字与 - _ . ，空值时落到 _unsorted */
    private static String safeDir(String issueCode) {
        String s = (issueCode == null ? "" : issueCode).replaceAll("[^A-Za-z0-9._-]", "_").trim();
        return s.isEmpty() ? "_unsorted" : s;
    }

    /** 文件名：去掉路径分隔符，避免写入越界 */
    private static String safeName(String filename) {
        String s = (filename == null ? "" : filename).replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (s.length() > 120) s = s.substring(s.length() - 120);
        return s.isEmpty() ? "unnamed" : s;
    }
}
