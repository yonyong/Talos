package com.yonyong.talos.agent;

import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;

/**
 * 探测执行器：服务端「设置面板」的测试按钮经 gRPC 双向流下发 PROBE_REQ，
 * 在客户端本机真实执行后回 PROBE_RESULT。
 *
 * C/S 架构约束：服务端无法主动访问客户端，一切「测试」必须在客户端本机执行 ——
 * Agent CLI 用 --version 验证可执行性；Git 用 ls-remote 验证 Token 真实可用；
 * 工具链验证工作目录与 Maven 安装。
 */
@Slf4j
public class ProbeExecutor {

    private static final int PROBE_TIMEOUT_SEC = 25;

    private final ConfigStore configStore;
    private final BiConsumer<String, Map<String, Object>> sender;

    public ProbeExecutor(ConfigStore configStore, BiConsumer<String, Map<String, Object>> sender) {
        this.configStore = configStore;
        this.sender = sender;
    }

    /** 探测可能耗时数十秒，必须挪出 gRPC 回调线程 */
    public void submit(Map<String, Object> payload) {
        Thread t = new Thread(() -> run(payload), "talos-probe");
        t.setDaemon(true);
        t.start();
    }

    private void run(Map<String, Object> payload) {
        String probeId = String.valueOf(payload.get("probeId"));
        String kind = String.valueOf(payload.get("kind"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("probeId", probeId);
        result.put("kind", kind);
        try {
            switch (kind) {
                case "agent" -> result.putAll(probeAgent(payload));
                case "git" -> result.putAll(probeGit(payload));
                case "toolchain" -> result.putAll(probeToolchain(payload));
                default -> {
                    result.put("ok", false);
                    result.put("message", "未知探测类型: " + kind);
                }
            }
        } catch (Exception e) {
            result.put("ok", false);
            result.put("message", "探测执行异常: " + e.getMessage());
        }
        sender.accept("PROBE_RESULT", result);
        log.info("探测完成: {} kind={} ok={}", probeId, kind, result.get("ok"));
    }

    /** Agent CLI 可执行性：执行 <execPath> --version，退出码 0 即通过 */
    private Map<String, Object> probeAgent(Map<String, Object> p) {
        Map<String, Object> r = new LinkedHashMap<>();
        String exec = str(p.get("execPath"));
        if (exec.isBlank()) {
            r.put("ok", false);
            r.put("message", "未填写 CLI 路径（execPath）");
            return r;
        }
        Result ver = exec(List.of(exec, "--version"), PROBE_TIMEOUT_SEC, null);
        r.put("ok", ver.ok);
        r.put("output", ver.output);
        if (!ver.ok) r.put("message", ver.output.isBlank() ? "CLI 执行失败（退出码 " + ver.exitCode + "）" : ver.output);
        return r;
    }

    /** Git：先 git --version；给了 repoUrl 就用 Token 真实 ls-remote 一次 */
    private Map<String, Object> probeGit(Map<String, Object> p) {
        Map<String, Object> r = new LinkedHashMap<>();
        StringBuilder out = new StringBuilder();

        Result ver = exec(List.of("git", "--version"), 15, null);
        out.append(ver.output.strip()).append('\n');
        if (!ver.ok) {
            r.put("ok", false);
            r.put("output", out.toString());
            r.put("message", "本机未找到可用的 git 命令");
            return r;
        }

        String repoUrl = str(p.get("repoUrl"));
        String token = str(p.get("token"));
        if (repoUrl.isBlank()) {
            r.put("ok", true);
            r.put("output", out.toString());
            r.put("message", "git 可用（未填仓库地址，跳过 Token 实测）");
            return r;
        }
        if (token.isBlank() && (repoUrl.startsWith("https://") || repoUrl.startsWith("http://"))) {
            r.put("ok", false);
            r.put("output", out.toString());
            r.put("message", "未配置 Git Token，https 仓库无法鉴权");
            return r;
        }

        String authed = authedUrl(repoUrl, token);
        // 非交互探测：禁用凭据助手与一切提示通道，鉴权失败立即报错而非弹 GUI 弹窗挂到超时
        // （否则 git 鉴权失败会触发 Credential Manager 弹窗，进程等待用户点击，最终 25s 超时）
        Result ls = exec(List.of("git", "-c", "credential.helper=", "ls-remote", authed, "HEAD"),
                PROBE_TIMEOUT_SEC, null, Map.of(
                        "GIT_TERMINAL_PROMPT", "0",
                        "GIT_ASKPASS", "echo",
                        "GCM_INTERACTIVE", "never",
                        "GIT_SSH_COMMAND", "ssh -oBatchMode=yes"));
        out.append(ls.output.strip()).append('\n');
        r.put("ok", ls.ok);
        r.put("output", out.toString());
        r.put("message", ls.ok ? "Token 鉴权成功：" + repoUrl : "ls-remote 失败（Token 无效或无权限/仓库不可达）");
        return r;
    }

    /** 工具链：工作目录存在性 + Maven 安装与版本 */
    private Map<String, Object> probeToolchain(Map<String, Object> p) {
        Map<String, Object> r = new LinkedHashMap<>();
        StringBuilder out = new StringBuilder();
        boolean ok = true;
        String message;

        String workDir = str(p.get("workDir"));
        if (!workDir.isBlank()) {
            boolean exists = Files.isDirectory(Paths.get(workDir));
            out.append("工作目录 ").append(workDir).append("：").append(exists ? "存在" : "不存在（执行时将自动创建）").append('\n');
            if (!exists) ok = false;
        }

        String mavenHome = str(p.get("mavenHome"));
        if (!mavenHome.isBlank()) {
            Path mvn = Paths.get(mavenHome, "bin", isWindows() ? "mvn.cmd" : "mvn");
            if (!Files.isRegularFile(mvn)) {
                ok = false;
                out.append("Maven 目录 ").append(mavenHome).append("：未找到 bin/mvn").append(isWindows() ? ".cmd" : "").append('\n');
            } else {
                Result mv = exec(List.of(mvn.toString(), "--version"), PROBE_TIMEOUT_SEC, null);
                out.append(mv.output.strip()).append('\n');
                if (!mv.ok) ok = false;
            }
        } else {
            Result mv = exec(List.of("mvn", "--version"), PROBE_TIMEOUT_SEC, null);
            out.append("PATH 中的 Maven：").append(mv.ok ? mv.output.strip() : "未找到 mvn 命令").append('\n');
            if (!mv.ok) ok = false;
        }

        message = ok ? "工具链检查通过" : "工具链检查发现问题，详见输出";
        r.put("ok", ok);
        r.put("output", out.toString());
        r.put("message", message);
        return r;
    }

    /** https/http 地址拼 Token（与任务执行时的 clone 鉴权同一条规则） */
    private String authedUrl(String url, String token) {
        if (token == null || token.isBlank()) return url;
        if (url.startsWith("https://")) return "https://oauth2:" + token + "@" + url.substring("https://".length());
        if (url.startsWith("http://")) return "http://oauth2:" + token + "@" + url.substring("http://".length());
        return url;
    }

    private record Result(boolean ok, String output, int exitCode) { }

    private Result exec(List<String> argv, int timeoutSec, Path workdir) {
        return exec(argv, timeoutSec, workdir, Map.of());
    }

    private Result exec(List<String> argv, int timeoutSec, Path workdir, Map<String, String> env) {
        try {
            List<String> full = new ArrayList<>();
            if (isWindows()) {
                // Windows 下 .cmd/.bat 及 PATH 中的命令都要经 cmd.exe 启动
                full.add("cmd");
                full.add("/c");
            }
            full.addAll(argv);

            ProcessBuilder pb = new ProcessBuilder(full);
            if (workdir != null && Files.isDirectory(workdir)) pb.directory(workdir.toFile());
            if (env != null && !env.isEmpty()) pb.environment().putAll(env);
            pb.redirectErrorStream(true);
            Process proc = pb.start();

            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            Thread reader = new Thread(() -> {
                try (InputStream in = proc.getInputStream()) {
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                } catch (IOException ignored) {
                    // 进程被强杀时读流中断，属预期
                }
            }, "talos-probe-reader");
            reader.setDaemon(true);
            reader.start();

            if (!proc.waitFor(timeoutSec, TimeUnit.SECONDS)) {
                proc.destroyForcibly();
                return new Result(false, "执行超时（" + timeoutSec + "s）", -1);
            }
            reader.join(1500);
            String output = OutputDecoder.decode(buf).strip();
            if (output.length() > 4000) output = output.substring(0, 4000) + "\n…（已截断）";
            return new Result(proc.exitValue() == 0, output, proc.exitValue());
        } catch (Exception e) {
            return new Result(false, "执行失败: " + e.getMessage(), -1);
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static String str(Object o) {
        return o == null || "null".equals(String.valueOf(o)) ? "" : String.valueOf(o).strip();
    }
}
