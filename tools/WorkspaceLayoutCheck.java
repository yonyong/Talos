package com.yonyong.talos.agent;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 离线校验「工作区目录布局 + 执行日志时间戳」这两件事。
 *
 * <p>不碰网络的验证方式：把 repoUrl 指向本机临时建的裸仓库（hostPortOf 认出是本地路径 → 跳过连通性探测），
 * 于是 clone / fetch / 切分支全在本地跑完，但走的仍是 prepareWorkspace 里**同一条代码路径**。
 * github 出口断着也能验，且不污染真机工作区（真机跑的是 D:/opt/applications/talos/workspace）。
 *
 * <p>跑法（先打包客户端，classpath 直接用 fat jar；⚠️ javac/java 路径**必须写 Windows 绝对路径**，
 * 配合 `MSYS_NO_PATHCONV=1` 时 `/d/tmp/...` 不会被转换，Windows 版 javac 找不到文件）：
 * <pre>
 * cd client &amp;&amp; mvn -o -q -DskipTests package
 * cd .. &amp;&amp; mkdir -p D:/tmp/wsc &amp;&amp; cp tools/WorkspaceLayoutCheck.java D:/tmp/wsc/
 * javac -encoding UTF-8 -cp client/target/talos-agent.jar -d D:/tmp/wsc/out D:/tmp/wsc/WorkspaceLayoutCheck.java
 * java -Dfile.encoding=UTF-8 -cp "client/target/talos-agent.jar;D:/tmp/wsc/out" com.yonyong.talos.agent.WorkspaceLayoutCheck
 * </pre>
 *
 * <p>为什么要有它：目录布局是「跑起来才发现错」的东西 —— 布局错了 git 命令全都成功，
 * 只是东西落在了别处，界面上一条报错都不会有。这里的断言把布局钉死，改坏了立刻红。
 */
public class WorkspaceLayoutCheck {

    static int fail = 0;

    /** 每条命令前缀的时间戳，格式与 TaskExecutor.TRACE_TS 对齐 */
    static final Pattern STAMPED_CMD = Pattern.compile("^\\[(\\d{2}):(\\d{2}):(\\d{2})] \\$ ");
    /** 带戳但不是命令行的行 = 输出块被误加戳 */
    static final Pattern STAMPED_NON_CMD = Pattern.compile("^\\[\\d{2}:\\d{2}:\\d{2}] (?!\\$ )");

    static void expect(String name, Object actual, Object want) {
        boolean ok = String.valueOf(actual).equals(String.valueOf(want));
        if (!ok) fail++;
        System.out.printf("%s %-40s 实际=%s%n", ok ? "[OK]" : "[FAIL]", name, actual);
        if (!ok) System.out.println("     期望=" + want);
    }

    static void expectTrue(String name, boolean ok, String detail) {
        if (!ok) fail++;
        System.out.printf("%s %-40s %s%n", ok ? "[OK]" : "[FAIL]", name, detail);
    }

    public static void main(String[] args) throws Exception {
        Path base = Paths.get("D:/tmp/wslayout").toAbsolutePath();
        deleteRecursively(base);
        Files.createDirectories(base);

        String origin = setUpOriginRepo(base);

        // yml 的 workspace 与个人设置的 workDir 故意不同：断言生效的是个人设置那个（优先级更高）
        Path fromYml = base.resolve("from-yml");
        Path fromSetting = base.resolve("from-setting");
        Path conf = base.resolve("agent.yml");
        Files.writeString(conf, """
                server:
                  addr: 127.0.0.1
                  port: 19443
                client:
                  id: check-machine
                  token: ""
                  workspace: "%s"
                  heartbeatSeconds: 10
                agents: []
                log:
                  dir: logs
                """.formatted(fromYml.toString().replace("\\", "/")), StandardCharsets.UTF_8);

        AgentConfig config = new AgentConfig(conf);
        ConfigStore store = new ConfigStore();
        store.getToolchain().put("workDir", fromSetting.toString());

        TaskExecutor exec = new TaskExecutor(config, store,
                (type, payload) -> { /* 离线校验：不回执 */ },
                () -> null);

        Method prepare = TaskExecutor.class.getDeclaredMethod("prepareWorkspace", Map.class, List.class);
        prepare.setAccessible(true);

        System.out.println("=== 首次执行 REQ-2251：应落在 <workDir>/REQ-2251/<仓库名> 并在本地 clone ===");
        List<String> trace1 = new ArrayList<>();
        Path repo1 = (Path) prepare.invoke(exec, task("REQ-2251", origin, "feature/req-2251"), trace1);
        printTrace(trace1);
        Path want1 = fromSetting.resolve("REQ-2251").resolve("origin");
        expect("检出路径", repo1, want1);
        expectTrue("仓库就位", Files.isDirectory(repo1.resolve(".git")), repo1.toString());
        expectTrue("未使用 yml 的 workspace（个人设置优先）",
                !repo1.startsWith(fromYml), "落在 " + fromSetting);
        expectTrue("工作分支已切出",
                "feature/req-2251".equals(currentBranch(repo1)), currentBranch(repo1));

        System.out.println();
        System.out.println("=== 同一 Issue 重跑：应复用同一目录，走 fetch 而不是再 clone ===");
        List<String> trace2 = new ArrayList<>();
        Path repo2 = (Path) prepare.invoke(exec, task("REQ-2251", origin, "feature/req-2251"), trace2);
        printTrace(trace2);
        expect("复用同一路径", repo2, repo1);
        expectTrue("走的是 fetch", anyContains(trace2, " fetch "), "命令行含 fetch");
        expectTrue("没有再 clone", !anyContains(trace2, "clone"), "命令行不含 clone");

        System.out.println();
        System.out.println("=== 另一个 Issue：必须是另一份独立工作副本 ===");
        List<String> trace3 = new ArrayList<>();
        Path repo3 = (Path) prepare.invoke(exec, task("REQ-2300", origin, "feature/req-2300"), trace3);
        Path want3 = fromSetting.resolve("REQ-2300").resolve("origin");
        expect("检出路径", repo3, want3);
        expectTrue("两条路径不重叠", !repo1.equals(repo3), repo1 + " / " + repo3);
        expectTrue("各自克隆成功",
                Files.isDirectory(repo1.resolve(".git")) && Files.isDirectory(repo3.resolve(".git")),
                "两份 .git 都在");
        expectTrue("分支互不干扰",
                "feature/req-2251".equals(currentBranch(repo1))
                        && "feature/req-2300".equals(currentBranch(repo3)),
                currentBranch(repo1) + " / " + currentBranch(repo3));

        System.out.println();
        System.out.println("=== 时间戳：只有 $ 命令行带戳，输出块与注释行保持原样 ===");
        List<String> all = new ArrayList<>();
        all.addAll(trace1);
        all.addAll(trace2);
        all.addAll(trace3);
        int cmds = 0, stampedCmds = 0, bareCmds = 0, badNonCmd = 0, monotonicBreaks = 0;
        int lastSec = -1;
        for (String line : all) {
            if (line.startsWith("$ ")) bareCmds++;
            Matcher m = STAMPED_CMD.matcher(line);
            if (m.find()) {
                stampedCmds++;
                int sec = Integer.parseInt(m.group(1)) * 3600 + Integer.parseInt(m.group(2)) * 60
                        + Integer.parseInt(m.group(3));
                if (sec < lastSec) monotonicBreaks++;
                lastSec = sec;
            }
            if (STAMPED_NON_CMD.matcher(line).find()) badNonCmd++;
        }
        // 命令行里可能出现 "git"，但用「带戳且以 $ 开头」与「不带戳的 $ 开头」两条来夹
        cmds = stampedCmds + bareCmds;
        System.out.println("命令 " + cmds + " 条 · 带戳 " + stampedCmds + " 条 · 裸 $ 行 " + bareCmds
                + " 条 · 带戳的非命令行 " + badNonCmd + " 条");
        expectTrue("每条命令都有戳（无裸 $ 行）", bareCmds == 0, "裸 $ 行 " + bareCmds);
        expectTrue("命令数 > 0", cmds > 0, "命令 " + cmds + " 条");
        expectTrue("带戳的都不是输出/注释行", badNonCmd == 0, "违规 " + badNonCmd + " 条");
        expectTrue("时间戳单调不减", monotonicBreaks == 0, "倒退 " + monotonicBreaks + " 次");
        expectTrue("输出块未被加戳（存在无戳的非命令行）", all.stream().anyMatch(
                        l -> !l.startsWith("[") && !l.startsWith("$ ")),
                "例：" + all.stream().filter(l -> !l.startsWith("[") && !l.startsWith("$ "))
                        .findFirst().orElse("（无）"));

        System.out.println();
        System.out.println("=== 落盘结构 ===");
        try (var s = Files.walk(fromSetting, 2)) {
            s.filter(Files::isDirectory).forEach(p -> System.out.println("  " + fromSetting.relativize(p)));
        }
        System.out.println("  （临时目录：" + base + "）");

        System.out.println();
        System.out.println(fail == 0 ? "全部通过" : ("失败 " + fail + " 项"));
        if (fail > 0) System.exit(1);
    }

    static Map<String, Object> task(String issueCode, String repoUrl, String branch) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("issueCode", issueCode);
        t.put("repoUrl", repoUrl);
        t.put("branch", branch);
        t.put("node", "拉取 Git");
        t.put("kind", "git");
        return t;
    }

    /** 建一个只有一次提交的本地裸仓库，当 clone 源用；不碰 github，也不需要网络 */
    static String setUpOriginRepo(Path base) throws Exception {
        Path source = base.resolve("source");
        Files.createDirectories(source);
        run(base, "git", "init", "-q", "-b", "main", source.toString());
        Files.writeString(source.resolve("README.md"), "talos workspace layout check\n", StandardCharsets.UTF_8);
        run(source, "git", "add", "-A");
        run(source, "git", "-c", "user.name=check", "-c", "user.email=check@local",
                "commit", "-q", "-m", "init");
        Path origin = base.resolve("origin.git");
        run(base, "git", "clone", "-q", "--bare", source.toString(), origin.toString());
        return origin.toString();
    }

    static void run(Path dir, String... argv) throws Exception {
        String[] cmd = new String[argv.length + 2];
        cmd[0] = "cmd";
        cmd[1] = "/c";
        System.arraycopy(argv, 0, cmd, 2, argv.length);
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(dir.toFile()).redirectErrorStream(true);
        Process p = pb.start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (!p.waitFor(60, java.util.concurrent.TimeUnit.SECONDS)) {
            p.destroyForcibly();
            throw new IllegalStateException("命令超时: " + String.join(" ", argv));
        }
        if (p.exitValue() != 0) {
            throw new IllegalStateException("命令失败(" + p.exitValue() + "): "
                    + String.join(" ", argv) + "\n" + out);
        }
    }

    static String currentBranch(Path repo) {
        try {
            Process p = new ProcessBuilder("cmd", "/c", "git", "branch", "--show-current")
                    .directory(repo.toFile()).redirectErrorStream(true).start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).strip();
            p.waitFor();
            return out;
        } catch (Exception e) {
            return "（取不到）";
        }
    }

    static boolean anyContains(List<String> lines, String needle) {
        return lines.stream().anyMatch(l -> l.contains(needle));
    }

    static void printTrace(List<String> trace) {
        trace.forEach(l -> System.out.println("    | " + l));
    }

    static void deleteRecursively(Path p) throws Exception {
        if (!Files.exists(p)) return;
        try (var s = Files.walk(p)) {
            s.sorted(Comparator.reverseOrder()).forEach(x -> {
                try {
                    Files.deleteIfExists(x);
                } catch (Exception ignored) {
                    // 只读文件（.git 对象）删不掉就留着，下一轮会新建目录
                }
            });
        }
    }
}
