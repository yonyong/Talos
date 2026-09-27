package com.yonyong.talos.agent;

import lombok.extern.slf4j.Slf4j;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiConsumer;

/**
 * 静默升级。
 *
 * 收到服务端 COMMAND UPGRADE 后，在后台完成：下载 → 校验 SHA256 → 落暂存目录
 * → 交给 apply-upgrade.bat 替换 jar 并重启，全过程无需研发人员介入，
 * 升级结果（成功/失败原因）回传服务端，避免升级变成黑盒。
 *
 * 关键约束：
 * - 只有以 jar 方式运行时才能自升级（IDE 里跑 classes 目录时直接拒绝）
 * - SHA256 不匹配一律丢弃，绝不替换本地 jar
 * - jar 正被当前 JVM 占用，无法自我替换，因此必须由独立批处理进程完成替换
 */
@Slf4j
public class Upgrader {

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 120_000;

    private final AgentConfig config;
    private final BiConsumer<String, Map<String, Object>> sender;
    private final Runnable stopDaemon;

    public Upgrader(AgentConfig config,
                    BiConsumer<String, Map<String, Object>> sender,
                    Runnable stopDaemon) {
        this.config = config;
        this.sender = sender;
        this.stopDaemon = stopDaemon;
    }

    /** 异步执行升级，调用方（消息处理线程）立即返回 */
    public void applyAsync(Map<String, Object> payload) {
        Thread t = new Thread(() -> apply(payload), "talos-upgrade");
        t.setDaemon(false);
        t.start();
    }

    private void apply(Map<String, Object> payload) {
        String version = str(payload.get("version"));
        String sha256 = str(payload.get("sha256"));
        boolean restart = !"false".equalsIgnoreCase(str(payload.getOrDefault("restart", "true")));

        if (!config.allowUpgrade()) {
            report("FAILED", version, "本机配置 client.allowUpgrade=false，已拒绝远程升级");
            return;
        }

        Path currentJar = currentJar();
        if (currentJar == null) {
            report("FAILED", version, "当前非 jar 方式运行（IDE/类目录），无法自升级");
            return;
        }

        report("STARTED", version, "开始下载 " + version);
        Path staged;
        try {
            String url = resolveUrl(str(payload.get("url")));
            staged = download(url, version, sha256);
        } catch (Exception e) {
            report("FAILED", version, "下载失败: " + rootMessage(e));
            return;
        }

        if (!restart) {
            // 只预下载不替换：替换必然伴随重启，等下次指令再应用
            report("DOWNLOADED", version, "已预下载到 upgrade\\" + staged.getFileName() + "（未要求重启，本次不替换）");
            return;
        }

        // 运行中的 JVM 会锁住自己的 jar，进程内替换必然失败（实测 AccessDenied），
        // 因此替换与重启只能交给另一个进程：本进程退出后它再动手。
        Path script = currentJar.getParent().resolve("scripts").resolve("apply-upgrade.bat");
        if (!Files.isRegularFile(script)) {
            report("FAILED", version, "缺少替换脚本 scripts\\apply-upgrade.bat");
            return;
        }

        report("APPLYING", version, "校验通过，交由替换脚本落盘并重启");
        try {
            spawnApplier(script, staged);
        } catch (Exception e) {
            report("FAILED", version, "启动替换脚本失败: " + rootMessage(e));
            return;
        }

        report("RESTARTING", version, "即将退出，由替换脚本替换并拉起新版本");
        // 给上行消息留出发送时间，然后交出进程
        try {
            Thread.sleep(400);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        log.info("升级完成，退出当前进程");
        stopDaemon.run();
        System.exit(0);
    }

    /**
     * 拉起替换脚本。
     *
     * 刻意不走 start / PowerShell：两者都需要控制台，而本进程是被运行中的 agent
     * （ProcessBuilder）拉起的无控制台进程，在那种上下文里 start 会静默失败、
     * PowerShell 会直接卡住，结果是「升级成功但客户端再也没起来」。
     * 直接 ProcessBuilder 调 cmd 没有这个问题，脚本本身会用前台方式拉起新版本。
     */
    private void spawnApplier(Path script, Path staged) throws Exception {
        Path upgradeLog = installRoot().resolve(config.logDir()).resolve("upgrade.log");
        Files.createDirectories(upgradeLog.getParent());

        ProcessBuilder pb = new ProcessBuilder("cmd", "/c",
                script.toString(), staged.toString(), String.valueOf(ProcessHandle.current().pid()));
        pb.directory(installRoot().toFile());
        pb.redirectErrorStream(true);
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(upgradeLog.toFile()));
        Process p = pb.start();
        log.info("替换脚本已启动，PID={}（本进程退出后由它完成替换与重启）", p.pid());
    }

    /** 下载到 <安装目录>/upgrade 并校验 SHA256；校验失败抛异常，不落最终文件 */
    private Path download(String url, String version, String expectSha) throws Exception {
        Path dir = installRoot().resolve("upgrade");
        Files.createDirectories(dir);
        Path part = dir.resolve("talos-agent-" + safe(version) + ".jar.download");
        Path target = dir.resolve("talos-agent-" + safe(version) + ".jar");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "talos-agent-upgrader");
            int code = conn.getResponseCode();
            if (code != 200) throw new IllegalStateException("HTTP " + code + " · " + url);

            try (InputStream in = conn.getInputStream();
                 OutputStream out = Files.newOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
                log.info("升级包下载完成: {} bytes", total);
            }
        } finally {
            if (conn != null) conn.disconnect();
        }

        String actual = sha256(part);
        if (expectSha != null && !expectSha.isBlank() && !"null".equals(expectSha)
                && !expectSha.equalsIgnoreCase(actual)) {
            Files.deleteIfExists(part);
            throw new IllegalStateException("SHA256 校验失败（期望 " + head(expectSha) + "，实际 " + head(actual) + "）");
        }
        if (expectSha == null || expectSha.isBlank()) {
            log.warn("服务端未提供 SHA256，跳过分包完整性校验");
        }
        Files.move(part, target, StandardCopyOption.REPLACE_EXISTING);
        return target;
    }

    /** 服务端给绝对地址就直接用；给相对路径时按 server.addr + httpPort 拼 */
    private String resolveUrl(String raw) {
        if (raw == null || raw.isBlank() || "null".equals(raw)) {
            return "http://" + config.serverAddr() + ":" + config.httpPort() + "/api/agent/release/download";
        }
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        String path = raw.startsWith("/") ? raw : "/" + raw;
        return "http://" + config.serverAddr() + ":" + config.httpPort() + path;
    }

    /**
     * 安装根目录：以 jar 所在目录为准，避免用户从别处启动时把升级包下到错误位置。
     * 非 jar 方式运行时退回当前工作目录。
     */
    private Path installRoot() {
        Path jar = currentJar();
        return jar != null ? jar.getParent() : Paths.get("").toAbsolutePath();
    }

    /** 当前运行的 jar 路径；非 jar 方式返回 null */
    private Path currentJar() {
        try {
            URI uri = Upgrader.class.getProtectionDomain().getCodeSource().getLocation().toURI();
            Path p = Paths.get(uri);
            if (!Files.isRegularFile(p)) return null;
            return p.getFileName().toString().toLowerCase().endsWith(".jar") ? p : null;
        } catch (Exception e) {
            return null;
        }
    }

    private void report(String stage, String version, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("stage", stage);
        m.put("version", version);
        m.put("message", message);
        m.put("fromVersion", version());
        sender.accept("UPGRADE_STATE", m);
        log.info("升级状态上报: {} · {} · {}", stage, version, message);
    }

    private static String version() {
        String v = AgentApplication.class.getPackage().getImplementationVersion();
        return v == null ? "dev" : v;
    }

    private static String sha256(Path file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String safe(String s) {
        String t = s == null ? "unknown" : s.replaceAll("[^0-9A-Za-z._-]", "");
        return t.isBlank() ? "unknown" : t;
    }

    private static String head(String s) {
        if (s == null) return "—";
        return s.length() <= 16 ? s : s.substring(0, 8) + "…";
    }

    private static String rootMessage(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && c.getCause() != c) c = c.getCause();
        String m = c.getMessage();
        return m == null ? c.getClass().getSimpleName() : new String(m.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
