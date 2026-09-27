package com.yonyong.talos.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.jar.JarFile;
import java.util.jar.Manifest;
import java.util.stream.Stream;

/**
 * 客户端版本源。
 *
 * 版本库 = 发布目录（talos.agent.release-dir）内的 talos-agent*.jar / *.zip：
 * - 控制台「接入指南」页可上传新包、维护历史版本、指定「当前生效版本」；
 * - 「当前生效版本」由目录内的 .current 标记文件固定（可回退到旧版），
 *   未固定或被固定版本被删时回落到语义化版本最高的一个；
 * - 静默升级 / 下载页 / 接入指南共用同一来源，避免两处版本信息打架。
 */
@Slf4j
@Service
public class AgentReleaseService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
            .withZone(ZoneId.systemDefault());
    private static final long CACHE_TTL_MS = 15_000;
    /** 「当前生效版本」标记文件：内容即版本号 */
    private static final String PIN_FILE = ".current";

    /** 客户端安装包所在目录。默认指向本地构建产物 client/target（服务端 CWD 为项目根目录） */
    @Value("${talos.agent.release-dir:client/target}")
    private String releaseDir;

    /** 对外可访问的服务端根地址，用于拼下载链接；留空则用相对路径 */
    @Value("${talos.agent.public-base-url:}")
    private String publicBaseUrl;

    private volatile List<Release> cachedList;
    private volatile long cachedAt;

    public record Release(String version, String fileName, long size, String sha256,
                          String updatedAt, String downloadUrl, String path) { }

    /* ================================ 查询 ================================ */

    private Path dir() {
        return Paths.get(releaseDir).toAbsolutePath().normalize();
    }

    /** 全部版本（按版本号去重，同版本保留最新文件），按语义化版本降序 */
    public List<Release> listAll() {
        long now = System.currentTimeMillis();
        List<Release> c = cachedList;
        if (c != null && now - cachedAt < CACHE_TTL_MS) return c;
        List<Release> r = scanAll();
        cachedList = r;
        cachedAt = now;
        return r;
    }

    /**
     * 当前生效版本：优先取 .current 固定的版本；
     * 未固定、或被固定的版本已不存在时回落到版本最高的一个。
     */
    public Release latest() {
        List<Release> all = listAll();
        if (all.isEmpty()) return null;
        String pinned = readPin();
        if (pinned != null) {
            Release hit = all.stream().filter(r -> r.version().equals(pinned)).findFirst().orElse(null);
            if (hit != null) return hit;
            log.warn("固定的当前生效版本 {} 已不存在，回落到最高版本", pinned);
            clearPin();
        }
        return all.get(0);
    }

    /** 按版本号取单个安装包（历史版本下载用）；不存在返回 null */
    public Release byVersion(String version) {
        if (version == null || version.isBlank()) return null;
        return listAll().stream().filter(r -> r.version().equals(version.trim())).findFirst().orElse(null);
    }

    /** 对外暴露的元数据（不含本地路径） */
    public Optional<Release> publicLatest() {
        Release r = latest();
        return r == null ? Optional.empty() : Optional.of(r);
    }

    private List<Release> scanAll() {
        Path dir = dir();
        if (!Files.isDirectory(dir)) {
            log.warn("客户端发布目录不存在: {}（配置项 talos.agent.release-dir）", dir);
            return List.of();
        }
        try (Stream<Path> files = Files.list(dir)) {
            Map<String, Release> byVersion = new HashMap<>();
            for (Path p : files
                    .filter(Files::isRegularFile)
                    .filter(this::isPackage)
                    .toList()) {
                Release r = toRelease(p);
                Release prev = byVersion.get(r.version());
                if (prev == null || lastModified(p) > lastModified(Paths.get(prev.path()))) {
                    byVersion.put(r.version(), r);
                }
            }
            List<Release> list = new ArrayList<>(byVersion.values());
            list.sort((a, b) -> {
                int c = compare(b.version(), a.version());
                if (c != 0) return c;
                return Long.compare(lastModified(Paths.get(b.path())), lastModified(Paths.get(a.path())));
            });
            return list;
        } catch (IOException e) {
            log.error("扫描客户端发布目录失败", e);
            return List.of();
        }
    }

    /** 只认最终产物：talos-agent*.jar / *.zip（排除 shade 插件的 original-*） */
    private boolean isPackage(Path p) {
        String n = p.getFileName().toString().toLowerCase();
        return n.startsWith("talos-agent") && (n.endsWith(".jar") || n.endsWith(".zip"));
    }

    private Release toRelease(Path p) {
        String version = readVersion(p);
        return new Release(version, p.getFileName().toString(), sizeOf(p), sha256(p),
                TS.format(Instant.ofEpochMilli(lastModified(p))), downloadUrl(), p.toString());
    }

    private String downloadUrl() {
        return (publicBaseUrl == null || publicBaseUrl.isBlank())
                ? "/api/agent/release/download"
                : publicBaseUrl.replaceAll("/+$", "") + "/api/agent/release/download";
    }

    /* ================================ 维护 ================================ */

    /** 上传安装包到发布目录；文件名必须形如 talos-agent-<版本>.jar / .zip */
    public synchronized Release upload(InputStream in, String originalName) {
        String name = originalName == null ? "" : originalName.trim();
        String lower = name.toLowerCase();
        if (!(lower.startsWith("talos-agent") && (lower.endsWith(".jar") || lower.endsWith(".zip")))) {
            throw new IllegalArgumentException("只支持上传 talos-agent-<版本>.jar / .zip 安装包，当前文件名：" + name);
        }
        try {
            Files.createDirectories(dir());
            Path target = dir().resolve(name);
            try (InputStream s = in) {
                Files.copy(s, target, StandardCopyOption.REPLACE_EXISTING);
            }
            invalidate();
            Release r = toRelease(target);
            log.info("上传客户端安装包: {} · {} · {} bytes", r.version(), r.fileName(), r.size());
            return r;
        } catch (IOException e) {
            throw new IllegalStateException("保存安装包失败: " + e.getMessage(), e);
        }
    }

    /** 指定当前生效版本（写入 .current 标记），可用于回退到旧版 */
    public synchronized void activate(String version) {
        if (version == null || version.isBlank()) throw new IllegalArgumentException("缺少版本号");
        Release hit = byVersion(version);
        if (hit == null) throw new IllegalArgumentException("发布目录中不存在该版本: " + version);
        try {
            Files.createDirectories(dir());
            Files.writeString(dir().resolve(PIN_FILE), hit.version(), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            invalidate();
            log.info("当前生效客户端版本指定为: {}", hit.version());
        } catch (IOException e) {
            throw new IllegalStateException("写入版本标记失败: " + e.getMessage(), e);
        }
    }

    /** 删除某个安装包；若删除的正是当前生效版本则清除固定，回落到最高版本 */
    public synchronized void deleteFile(String fileName) {
        String name = fileName == null ? "" : fileName.trim();
        Path dir = dir();
        Path target = dir.resolve(name).normalize();
        if (!target.startsWith(dir) || !Files.isRegularFile(target)) {
            throw new IllegalArgumentException("安装包不存在: " + name);
        }
        String version = readVersion(target);
        try {
            Files.delete(target);
        } catch (IOException e) {
            throw new IllegalStateException("删除失败（文件可能被占用）: " + e.getMessage(), e);
        }
        if (version.equals(readPin())) clearPin();
        invalidate();
        log.info("删除客户端安装包: {} ({})", name, version);
    }

    /** 按需重新扫描（上传 / 指定 / 删除后立即生效，无需重启服务端） */
    public void invalidate() {
        cachedList = null;
        cachedAt = 0;
    }

    private String readPin() {
        try {
            Path p = dir().resolve(PIN_FILE);
            if (Files.isRegularFile(p)) {
                String v = Files.readString(p, StandardCharsets.UTF_8).trim();
                return v.isEmpty() ? null : v;
            }
        } catch (IOException ignored) { }
        return null;
    }

    private void clearPin() {
        try {
            Files.deleteIfExists(dir().resolve(PIN_FILE));
        } catch (IOException ignored) { }
    }

    /* ================================ 工具 ================================ */

    /** 读取 jar 内 MANIFEST 的 Implementation-Version，缺失时从文件名 talos-agent-<版本> 解析 */
    private String readVersion(Path jar) {
        if (jar.getFileName().toString().toLowerCase().endsWith(".jar")) {
            try (JarFile jf = new JarFile(jar.toFile())) {
                Manifest mf = jf.getManifest();
                if (mf != null) {
                    String v = mf.getMainAttributes().getValue("Implementation-Version");
                    if (v != null && !v.isBlank()) return v.trim();
                }
            } catch (Exception e) {
                log.warn("读取 {} 的 MANIFEST 失败: {}", jar.getFileName(), e.getMessage());
            }
        }
        String name = jar.getFileName().toString().replaceAll("\\.(jar|zip)$", "");
        String v = name.replaceFirst("(?i)^talos-agent-?", "");
        return v.isBlank() ? "unknown" : v;
    }

    private String sha256(Path file) {
        try (InputStream in = Files.newInputStream(file)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            log.warn("计算 SHA256 失败: {}", e.getMessage());
            return "";
        }
    }

    private long sizeOf(Path p) {
        try {
            return Files.size(p);
        } catch (IOException e) {
            return 0L;
        }
    }

    private long lastModified(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    public String releaseDir() {
        return dir().toString();
    }

    /** 客户端版本是否落后于当前发布版 */
    public boolean needsUpgrade(String clientVersion) {
        Release r = latest();
        if (r == null) return false;
        if (clientVersion == null || clientVersion.isBlank() || "dev".equals(clientVersion)) return true;
        return compare(clientVersion, r.version()) < 0;
    }

    /** 语义化版本比较，缺失段按 0 处理；非数字段（如 SNAPSHOT）忽略 */
    public static int compare(String a, String b) {
        String[] x = a.split("[.\\-+]");
        String[] y = b.split("[.\\-+]");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int xi = i < x.length ? num(x[i]) : 0;
            int yi = i < y.length ? num(y[i]) : 0;
            if (xi != yi) return Integer.compare(xi, yi);
        }
        return 0;
    }

    private static int num(String s) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
