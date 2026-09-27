package com.yonyong.talos.agent;

import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Coding Agent 适配层：统一拉起本地 CLI（claude / cursor / codex / codebuddy）。
 *
 * 执行参数对齐服务端「Coding Agent」页的约定：
 *   execPath      可执行文件路径或命令名
 *   argsTemplate  启动参数模板，占位符 {prompt} {repo} {branch} {model} 由客户端在收到任务时注入
 *   workDir       执行工作目录（相对仓库根）
 *   envVars       附加环境变量，格式 KEY=VALUE;KEY2=VALUE2
 * 服务端未配置的字段回退到客户端本地 agent.yml 的 cmd / args。
 *
 * 服务端只下发路径与模板，不持有也不下发任何模型密钥。
 */
@Slf4j
public class AgentCliRunner {

    /** 占位符：{prompt} {repo} {branch} {model} 等服务端约定字段 */
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{(\\w+)\\}");

    /** prompt 超过该长度时额外写一份临时文件，供 {promptFile} 使用 */
    private static final int PROMPT_FILE_THRESHOLD = 6000;

    public record Result(boolean ok, String output, int exitCode, String command) {
        public static Result fail(String message) { return new Result(false, message, -1, ""); }
    }

    public static Result run(Map<String, Object> cfg,
                             String prompt,
                             Path repoRoot,
                             Map<String, String> vars,
                             int timeoutSeconds) {
        if (cfg == null) {
            return Result.fail("未找到该后端的配置：服务端未下发，且客户端 agent.yml 中也没有对应 backend");
        }

        String exec = firstNonBlank(cfg.get("execPath"), cfg.get("cmd"), cfg.get("backend"));
        if (exec.isBlank()) return Result.fail("未配置 execPath / cmd");

        Map<String, String> allVars = new java.util.LinkedHashMap<>(vars);
        allVars.put("prompt", prompt == null ? "" : prompt);

        Path promptFile = null;
        try {
            if (prompt != null && prompt.length() > PROMPT_FILE_THRESHOLD) {
                promptFile = Files.createTempFile("talos-prompt-", ".txt");
                Files.writeString(promptFile, prompt, StandardCharsets.UTF_8);
                allVars.put("promptFile", promptFile.toString());
            }

            List<String> argv = new ArrayList<>();
            argv.add(exec);
            argv.addAll(buildArgs(cfg, allVars, prompt));

            Path workdir = resolveWorkDir(cfg, repoRoot);
            return exec(argv, workdir, envVars(cfg), timeoutSeconds);
        } catch (Exception e) {
            return Result.fail("调用失败: " + e.getMessage());
        } finally {
            if (promptFile != null) {
                try {
                    Files.deleteIfExists(promptFile);
                } catch (IOException ignored) {
                    // 临时文件清理失败不影响主流程
                }
            }
        }
    }

    /** 优先用服务端下发的 argsTemplate，其次本地 args 列表，最后直接把 prompt 作为唯一参数 */
    private static List<String> buildArgs(Map<String, Object> cfg, Map<String, String> vars, String prompt) {
        Object tpl = cfg.get("argsTemplate");
        if (tpl != null && !String.valueOf(tpl).isBlank()) {
            return splitArgs(render(String.valueOf(tpl), vars));
        }
        Object localArgs = cfg.get("args");
        if (localArgs instanceof List<?> list && !list.isEmpty()) {
            List<String> out = new ArrayList<>();
            for (Object o : list) out.add(render(String.valueOf(o), vars));
            return out;
        }
        return List.of(prompt == null ? "" : prompt);
    }

    /**
     * 占位符替换：用 appendReplacement 一次成型，替换结果不会被二次解析，
     * 因此 prompt 内容里出现 {repo} 之类的字面量也不会被误替换。
     */
    private static String render(String template, Map<String, String> vars) {
        Matcher m = PLACEHOLDER.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String v = vars.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(v == null ? "" : v));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** 按空格切分参数，双引号内视为整体（--msg "hello world"） */
    static List<String> splitArgs(String s) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"') {
                inQuote = !inQuote;
                continue;
            }
            if (Character.isWhitespace(c) && !inQuote) {
                if (cur.length() > 0) {
                    out.add(cur.toString());
                    cur.setLength(0);
                }
                continue;
            }
            cur.append(c);
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }

    private static Path resolveWorkDir(Map<String, Object> cfg, Path repoRoot) {
        Object wd = cfg.get("workDir");
        if (wd == null || String.valueOf(wd).isBlank() || repoRoot == null) return repoRoot;
        String rel = String.valueOf(wd).trim();
        if (".".equals(rel)) return repoRoot;
        Path p = repoRoot.resolve(rel);
        return Files.isDirectory(p) ? p : repoRoot;
    }

    private static Map<String, String> envVars(Map<String, Object> cfg) {
        Map<String, String> env = new java.util.LinkedHashMap<>();
        Object raw = cfg.get("envVars");
        if (raw != null && !String.valueOf(raw).isBlank()) {
            for (String pair : String.valueOf(raw).split(";")) {
                int i = pair.indexOf('=');
                if (i > 0) env.put(pair.substring(0, i).trim(), pair.substring(i + 1).trim());
            }
        }
        // pathPrepend：目录前置到子进程 PATH（如个人设置下发的 Maven bin），不改动系统环境
        Object prepend = cfg.get("pathPrepend");
        if (prepend != null && !String.valueOf(prepend).isBlank()) {
            String existing = env.getOrDefault("PATH", System.getenv("PATH") == null ? "" : System.getenv("PATH"));
            env.put("PATH", String.valueOf(prepend) + java.io.File.pathSeparator + existing);
        }
        return env;
    }

    private static Result exec(List<String> argv, Path workdir, Map<String, String> env,
                               int timeoutSeconds) throws IOException, InterruptedException {
        List<String> full = new ArrayList<>(argv);
        if (isWindows()) {
            // Windows 下 .cmd/.bat 必须经 cmd.exe 启动
            full.add(0, "/c");
            full.add(0, "cmd");
        }

        String shown = String.join(" ", argv);
        log.info("执行: {}", shown);

        ProcessBuilder pb = new ProcessBuilder(full);
        if (workdir != null && Files.isDirectory(workdir)) pb.directory(workdir.toFile());
        pb.redirectErrorStream(true);
        pb.environment().putAll(env);

        Process p = pb.start();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread reader = new Thread(() -> {
            try (InputStream in = p.getInputStream()) {
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    out.write(chunk, 0, n);
                }
            } catch (IOException ignored) {
                // 进程被强杀时读流中断，属预期
            }
        }, "talos-cli-reader");
        reader.setDaemon(true);
        reader.start();

        boolean finished = p.waitFor(Math.max(30, timeoutSeconds), TimeUnit.SECONDS);
        if (!finished) {
            // Windows 下 CLI 经 cmd.exe 启动，真正的 node 进程是「孙进程」：
            // 只 destroyForcibly 直接子进程会把它孤儿化 —— 实测它继续占着 stdout 管道与模型配额跑了 8 小时
            p.descendants().forEach(ProcessHandle::destroyForcibly);
            p.destroyForcibly();
            reader.join(2000);
            return new Result(false, "执行超时（" + timeoutSeconds + "s）：" + shown, -1, shown);
        }
        reader.join(2000);
        return new Result(p.exitValue() == 0, OutputDecoder.decode(out), p.exitValue(), shown);
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static String firstNonBlank(Object... values) {
        for (Object v : values) {
            if (v != null) {
                String s = String.valueOf(v).trim();
                if (!s.isEmpty() && !"null".equals(s)) return s;
            }
        }
        return "";
    }

    private AgentCliRunner() { }
}
