package com.yonyong.talos.agent;

import com.yonyong.talos.grpc.AgentServiceGrpc;
import com.yonyong.talos.grpc.ArtifactRequest;
import com.yonyong.talos.grpc.ArtifactResponse;
import io.grpc.ManagedChannel;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * 节点任务执行器。
 *
 * 按节点类型（kind）分两种执行方式，这是本类最重要的分派规则：
 * <ul>
 *   <li><b>机械节点</b>（{@link #MECHANICAL_KINDS}，如「拉取 Git」）：只做确定性操作，
 *       仓库 clone / fetch / 切分支就位即完成。<b>不选后端、不渲染 Prompt、不起 Coding Agent CLI，
 *       也不上报 CALL_LOG</b> —— 拉个仓库不需要模型，把它记成「AI 调用」既浪费额度又污染调用日志。</li>
 *   <li><b>Coding Agent 节点</b>（需求分析 / 编码 / 测试等）：准备仓库 → 渲染服务端 Prompt 模板
 *       → 调用本地 Coding Agent CLI → 回 TASK_RESULT → 回 CALL_LOG 供可观测。</li>
 * </ul>
 * 两类节点都会经 UploadArtifact 回传执行记录（含仓库准备痕迹），服务端可审计。
 * 单线程串行执行，避免多个任务并发改动同一工作区。
 */
@Slf4j
public class TaskExecutor {

    private static final int DEFAULT_TIMEOUT_SEC = 900;
    private static final int MAX_ARTIFACT_CHARS = 200_000;

    /**
     * 执行日志里每条命令前缀的时间戳（本机时区，精确到秒）。
     *
     * <p>只给 {@code $ 命令} 打戳，命令的输出块一个字节都不动 —— CLI 输出里全是多行块、
     * 进度条和 diff，逐行插时间戳会把内容打乱。节点粒度的时间另有 startedAt / finishedAt，
     * 日志面板右上角已经在显示。
     */
    private static final DateTimeFormatter TRACE_TS = DateTimeFormatter.ofPattern("HH:mm:ss");

    /** 机械节点类型：确定性操作，与模型无关。新增此类节点时同步扩这张表（服务端 WorkflowService 有同名判定） */
    private static final Set<String> MECHANICAL_KINDS = Set.of("git");

    /** 节点未指定后端时的占位符（模板里写的就是这个字面量） */
    private static final String NO_BACKEND = "—";

    /** 连接建立后长时间零进展就自己退出：公网仓库（github 等）抖动时不再盲等满超时 */
    private static final String LOW_SPEED_LIMIT = "http.lowSpeedLimit=1000";
    private static final String LOW_SPEED_TIME = "http.lowSpeedTime=30";

    /**
     * 代理变量：不跟随「谁拉起的 agent」。
     *
     * <p>agent 常常是从某个带临时本地代理的会话里被拉起来的（开发机上尤其常见），
     * git 继承这些变量后会在代理上静默挂死 —— 实测 fetch 零输出卡满 300s 超时，
     * 节点只留下一句「退出码 -1」，完全看不出是网络问题。需要代理时用 git 全局 http.proxy。
     */
    private static final List<String> PROXY_KEYS =
            List.of("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY");

    /**
     * 一律禁止 git 去调交互式凭据助手 / askpass。
     *
     * <p>这是实测定位出来的真凶（2026-09-27）：本机 system gitconfig 挂着
     * {@code credential.helper=helper-selector}（Git for Windows 的助手选择器，最终委派给 GCM）。
     * 当 URL 内嵌的 token 不被接受时，git **丢弃 URL 里的凭据转而询问助手**，而助手在无人值守会话里
     * 既不返回也不报错 —— 表现就是「零输出卡满超时」。同一地址同一时刻的对照很干净：
     * 匿名 2.2s 成功，带 token 挂满 20s 被中断。{@code GIT_TERMINAL_PROMPT=0} 管不了 GUI 助手，必须显式清空。
     *
     * <p>agent 永远自带凭据（https 注入 token / ssh 用密钥），助手里没有它需要的东西。
     * 清空后 token 失效会立刻得到 401，被归成「鉴权失败」，而不是耗满预算的假超时。
     */
    private static final List<String> NO_CRED_PROMPT =
            List.of("-c", "credential.helper=", "-c", "credential.interactive=false", "-c", "core.askPass=");

    /** 同类封堵的环境变量：askpass 程序一旦被继承进来同样会把命令挂住 */
    private static final List<String> PROMPT_ENV_KEYS =
            List.of("GIT_ASKPASS", "SSH_ASKPASS", "GIT_CREDENTIAL_HELPER");

    /** 组装一条「要联网」的 git 命令：禁交互凭据 + 握手后零进展自杀 */
    private static List<String> gitNet(String... args) {
        List<String> a = new ArrayList<>();
        a.add("git");
        a.addAll(NO_CRED_PROMPT);
        a.add("-c");
        a.add(LOW_SPEED_LIMIT);
        a.add("-c");
        a.add(LOW_SPEED_TIME);
        a.addAll(Arrays.asList(args));
        return a;
    }

    /**
     * 仓库准备阶段对网络的耐心上限。
     *
     * <p>实测（2026-09-27，github 出口被拦）：这条链路是**间歇性**的 —— 22:20 curl 连 21s 超时，
     * 22:24 连续 6 次 `git ls-remote` 全部 2s 内返回；22:31~22:37 又整段不通。
     * 原来的「3 次 × 90s 盲等 + 固定 3s 间隔」整段落进一个断网窗口就判节点死刑（连续 5 轮重跑全失败）。
     * 节点缺的不是重试次数，而是**在一个预算内一直等到窗口打开**。
     *
     * <p>给到 10 分钟是因为观测到的断网窗口本身就有 5 分钟以上。代价是失败最坏要等这么久，
     * 所以循环里必须认「取消」—— 用户在监控页点取消要能立刻出来，而不是被预算绑住。
     */
    private static final long GIT_NET_BUDGET_MS = 600_000;

    /**
     * 连通性探测命令：`git ls-remote &lt;url&gt; HEAD`，只握手不传文件，单次上限 20s。
     *
     * <p>为什么不用 TCP / HTTP HEAD 预检：本机对 github 是**半死**的 —— TCP 能握手、
     * HTTP HEAD 甚至返回「113ms 通过」，紧接着 fetch 就 `Recv failure: Connection was reset`。
     * ls-remote 走的是与 fetch **完全相同**的路径（TLS + 鉴权 + git 智能协议），结论才可信，
     * 而且顺带把「token 是否有效」一起验了。
     */
    private static final int PROBE_TIMEOUT_SEC = 20;

    /** 探测通过后 fetch 的上限：连接已被证明可用，中途假死交给 http.lowSpeedTime 掐 */
    private static final int FETCH_TIMEOUT_SEC = 90;

    /** 重试退避：下一次间隔 = min(上次 × 1.8, 上限) + 抖动 */
    private static final long BACKOFF_MAX_MS = 8000;

    private final AgentConfig config;
    private final ConfigStore configStore;
    private final BiConsumer<String, Map<String, Object>> sender;
    private final Supplier<ManagedChannel> channelProvider;

    private final ExecutorService pool = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "talos-task");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, Future<?>> running = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    public TaskExecutor(AgentConfig config,
                        ConfigStore configStore,
                        BiConsumer<String, Map<String, Object>> sender,
                        Supplier<ManagedChannel> channelProvider) {
        this.config = config;
        this.configStore = configStore;
        this.sender = sender;
        this.channelProvider = channelProvider;
    }

    /** 提交任务（异步，串行消费） */
    public void submit(Map<String, Object> task) {
        String taskId = str(task.get("taskId"));
        Future<?> f = pool.submit(() -> {
            try {
                execute(task);
            } catch (Exception e) {
                log.error("任务执行异常: {}", taskId, e);
            } finally {
                running.remove(taskId);
            }
        });
        running.put(taskId, f);
    }

    /** 直接回失败回执（签名校验不通过等未进入执行队列的场景），避免服务端任务悬置 */
    public void rejectTask(Map<String, Object> result) {
        pool.submit(() -> sender.accept("TASK_RESULT", result));
    }

    /** 服务端要求取消 */
    public void cancel(String taskId) {
        if (taskId == null) return;
        cancelled.add(taskId);
        Future<?> f = running.get(taskId);
        if (f != null) f.cancel(true);
        log.info("已取消任务: {}", taskId);
    }

    private void execute(Map<String, Object> task) {
        String taskId = str(task.get("taskId"));
        String instanceCode = str(task.get("instanceCode"));
        int step = intOf(task.get("step"));
        String node = str(task.get("node"));
        String kind = str(task.get("kind"));
        String issueCode = str(task.get("issueCode"));

        // 机械节点不参与后端选择：选出来也没人用，反而会在回执里写出一个假的「后端」
        boolean mechanical = isMechanical(kind);
        String backend = mechanical ? NO_BACKEND : configStore.pickBackend(str(task.get("backend")));
        String model = mechanical ? NO_BACKEND : configStore.modelOf(backend);

        long start = System.currentTimeMillis();
        boolean success = false;
        String output = "";
        String renderedPrompt = "";
        boolean missingVars = false;
        /** 执行痕迹：仓库准备过程中每条命令与其输出，并入执行日志供服务端审计 */
        List<String> trace = new ArrayList<>();

        log.info("开始执行任务 {} · issue={} · 节点={} · 类型={} · 执行方式={}", taskId, issueCode, node, kind,
                mechanical ? "机械（不调用模型）" : "Coding Agent/" + backend);

        try {
            if (cancelled.contains(taskId)) throw new IllegalStateException("任务已被取消");

            Path workdir = prepareWorkspace(task, trace);

            if (mechanical) {
                // 机械节点到此为止：仓库与工作分支就位就是它的全部产出（产出即 trace，无需再拼 output）
                trace.add(summarizeRepo(workdir, str(task.get("branch"))));
                success = true;
            } else {
                // 1) 渲染服务端下发的 Prompt 模板
                String templateName = str(task.get("promptTemplate"));
                String template = configStore.prompt(templateName);
                Map<String, Object> vars = buildVars(task);
                renderedPrompt = PromptRenderer.render(template, vars);

                Set<String> declared = PromptRenderer.variablesOf(template);
                List<String> missing = declared.stream().filter(v -> !vars.containsKey(v)).toList();
                missingVars = !missing.isEmpty();
                if (missingVars) log.warn("Prompt 变量缺失: {}", missing);

                if (renderedPrompt.isBlank()) {
                    renderedPrompt = "【" + node + "】Issue " + issueCode + " - " + str(task.get("issueTitle"))
                            + "\n请在该节点完成对应工作并输出结果。";
                    log.warn("未找到模板 {}，已回退为通用提示词", templateName);
                }

                // 2) 调用本地 Coding Agent CLI
                //    配置来源：服务端「Coding Agent」页下发优先，客户端 agent.yml 兜底，
                //    用户个人层（按拖拽优先级）已在服务端合并进下发报文
                Map<String, Object> agentCfg = configStore.effective(backend);
                String versionError = versionGuard(agentCfg);
                if (versionError != null) throw new IllegalStateException(versionError);
                applyToolchain(agentCfg);

                AgentCliRunner.Result r = AgentCliRunner.run(
                        agentCfg, renderedPrompt, workdir, cliVars(task, backend, workdir), timeoutOf(task));
                success = r.ok();
                output = r.output();
            }
        } catch (Exception e) {
            output = "执行失败: " + e.getMessage();
            log.error("任务 {} 执行失败", taskId, e);
        }

        long latency = System.currentTimeMillis() - start;

        // 3) 执行日志 = 仓库准备痕迹 + 节点产出；失败现场也要留档
        String execLog = trim(merge(String.join("\n", trace), output));
        if (!execLog.isBlank()) {
            uploadArtifact(issueCode, node + "-执行记录.txt", kind.isBlank() ? "执行记录" : kind, execLog);
        }

        // 4) 回执 → 推进工作流
        reportResult(instanceCode, step, success, execLog);

        // 5) AI 调用日志 → 服务端可观测（含渲染后的最终 Prompt）。
        //    只有真调了模型的节点才算 AI 调用：机械节点没有任何模型交互，上报只会把
        //    「拉取 Git」这类步骤记成 codebuddy 调用，污染耗时与成本统计。
        if (!mechanical) {
            reportCallLog(issueCode, node, kind, backend, model, renderedPrompt, missingVars, latency);
        } else {
            log.info("任务 {} 为机械节点（{}），未调用模型，不产生 AI 调用日志", taskId, kind);
        }

        log.info("任务 {} 结束 · success={} · 耗时 {}ms", taskId, success, latency);
    }

    /** 机械节点判定：与模型无关的确定性操作 */
    public static boolean isMechanical(String kind) {
        return kind != null && MECHANICAL_KINDS.contains(kind.trim().toLowerCase());
    }

    /** 工作区根目录：个人设置里的工作目录优先于客户端 agent.yml 的 client.workspace */
    private Path workspaceRoot() {
        String wsDir = configStore.getToolchain().getOrDefault("workDir", config.workspace());
        return Paths.get(wsDir == null || wsDir.isBlank() ? config.workspace() : wsDir).toAbsolutePath();
    }

    /**
     * Issue 编号 → 目录名片段。
     *
     * <p>issueCode 由服务端下发（REQ-2251 这类），但它最终会拼进文件系统路径，
     * 不设防的字符（{@code / \ : ..}）足以跳出工作区根目录，所以过一遍白名单再落地。
     *
     * <p>取不到编号时落 {@code unassigned}，而不是退回根目录 —— 退回根目录等于这些任务
     * 又共享同一份工作副本，正是这次要拆掉的东西。
     */
    static String issueSegment(String issueCode) {
        String s = issueCode == null ? "" : issueCode.trim();
        String safe = s.replaceAll("[^A-Za-z0-9._-]", "-");
        // "." 与 ".." 是路径语义而非目录名，白名单放过了它们，这里补一刀
        if (safe.isEmpty() || safe.replace(".", "").isEmpty()) return "unassigned";
        return safe.length() > 64 ? safe.substring(0, 64) : safe;
    }

    /**
     * 工作区准备：clone（首次）/ fetch + 切到服务端指定的分支。
     *
     * <p>目录层级：工作区根（个人设置 workDir 优先，缺省 agent.yml 的 client.workspace）
     * → 本 Issue 目录 → 仓库目录，即 {@code <workspace>/<issueCode>/<仓库名>/}。
     *
     * <p>每个 Issue 一份独立工作副本是刻意为之：按仓库共享一份克隆时，A 需求的未提交改动会在
     * B 需求切分支时被带走，切分支失败还会走 {@code -B} 兜底把改动直接搬到 B 的分支上 ——
     * 多需求并行时这份目录必然互相污染。代价是同一仓库每个 Issue 各克隆一次（磁盘 + 首次 clone 带宽）。
     *
     * <p>关键步骤失败一律抛出：工作区没准备好就往下跑，CLI 会在空目录或错误分支上瞎改，
     * 比直接失败危险得多。每步命令与输出写入 {@code trace}，作为执行日志的一部分。
     */
    private Path prepareWorkspace(Map<String, Object> task, List<String> trace) {
        Path ws = workspaceRoot().resolve(issueSegment(str(task.get("issueCode"))));
        try {
            Files.createDirectories(ws);
        } catch (IOException e) {
            throw new IllegalStateException("无法创建工作区: " + ws, e);
        }

        String repoUrl = str(task.get("repoUrl"));
        if (repoUrl.isBlank()) return ws;

        // 取仓库名：斜杠与反斜杠都要认。只按 '/' 切的话，反斜杠形式的地址（D:\tmp\x\origin.git）
        // 整串都会被当成目录名，Windows 的 resolve 见到绝对路径会直接替换前缀 → 跳出工作区根目录
        String name = repoUrl.replaceAll("[/\\\\]+$", "");
        int cut = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (cut >= 0) name = name.substring(cut + 1);
        name = name.replaceAll("\\.git$", "");
        if (name.isBlank()) name = "repo";
        Path candidate = ws.resolve(name);
        // 再兜一层：万一 name 里仍混进分隔符或盘符，resolve 会落到工作区外 —— 那等于不同 Issue
        // 的代码又回到同一个地方，宁可退到一个固定的仓库目录。结果必须 final，下面有 lambda 捕获它
        final Path repo = candidate.normalize().startsWith(ws.normalize()) ? candidate : ws.resolve("repo");

        String inherited = inheritedProxy();
        if (!inherited.isBlank()) {
            trace.add("已忽略会话继承的代理（" + inherited + "）——agent 的网络行为不该由谁拉起它决定；"
                    + "确需代理请配置 git 全局 http.proxy");
        }

        String authed = authedUrl(repoUrl);
        if (!Files.isDirectory(repo.resolve(".git"))) {
            log.info("克隆仓库: {} → {}", repoUrl, repo);
            // 克隆也要先探到窗口：原来一次 clone 直接给 600s，链路断着就白挂 10 分钟
            CmdResult r = withReachableNetwork(ws, repoUrl, authed, trace,
                    () -> execOut(ws, 600, trace, gitNet("clone", authed, repo.toString())));
            if (r.code() != 0) {
                throw new IllegalStateException("仓库克隆失败：" + gitReason(r) + "：" + repoUrl);
            }
        } else {
            // 旧仓库（clone 时未带 token）也要刷新 origin，保证 fetch/push 鉴权生效
            if (!authed.equals(repoUrl)) exec(repo, 30, trace, "git", "remote", "set-url", "origin", authed);
            CmdResult r = withReachableNetwork(repo, repoUrl, authed, trace,
                    () -> execOut(repo, FETCH_TIMEOUT_SEC, trace, gitNet("fetch", "--all", "--prune", "--progress")));
            if (r.code() != 0) {
                throw new IllegalStateException("拉取远端更新失败：" + gitReason(r) + "：" + repoUrl);
            }
        }
        applyGitIdentity(repo, trace);

        String branch = str(task.get("branch"));
        if (!branch.isBlank()) checkoutBranch(repo, branch, trace);
        return repo;
    }

    /**
     * 切到工作分支，三级兜底：
     * <ol>
     *   <li>本地或远端已有同名分支 → 直接切</li>
     *   <li>仅远端有 → 建本地分支跟踪 origin/&lt;branch&gt;</li>
     *   <li>远端也没有（该需求首次开工）→ 基于当前 HEAD 新建</li>
     * </ol>
     * 三级都失败才算失败。绝不允许「切不过去就留在默认分支上继续编码」——
     * 那会让 AI 直接改主干。
     */
    private void checkoutBranch(Path repo, String branch, List<String> trace) {
        int code = exec(repo, 120, trace, "git", "checkout", branch);
        if (code == 0) return;

        code = exec(repo, 120, trace, "git", "checkout", "-B", branch, "origin/" + branch);
        if (code == 0) return;

        // 远端没有该分支：首次开发该需求，从当前 HEAD 拉出工作分支
        trace.add("远端无 " + branch + "，基于当前 HEAD 新建工作分支");
        code = exec(repo, 120, trace, "git", "checkout", "-B", branch);
        if (code != 0) {
            throw new IllegalStateException("切换到工作分支失败（git checkout 退出码 " + code + "）: " + branch);
        }
    }

    /** 机械节点收尾摘要：确认当前分支与 HEAD，服务端日志里一眼看出仓库是否真的就位 */
    private String summarizeRepo(Path repo, String branch) {
        if (repo == null || !Files.isDirectory(repo)) return "仓库未就位：" + repo;
        String head = capture(repo, "git", "rev-parse", "--short", "HEAD");
        String cur = capture(repo, "git", "branch", "--show-current");
        StringBuilder sb = new StringBuilder("仓库已就位");
        if (!head.isBlank()) sb.append(" · HEAD ").append(head);
        if (!cur.isBlank()) sb.append(" · 当前分支 ").append(cur);
        if (!branch.isBlank() && !branch.equals(cur)) sb.append(" · 期望分支 ").append(branch);
        return mask(sb.toString());
    }

    /**
     * https 地址拼入个人设置下发的 Git Token（oauth2:&lt;token&gt;@）。
     * ssh 地址不处理（依赖本机密钥）；未配置 token 时原样返回。
     */
    private String authedUrl(String url) {
        String token = configStore.getGit().get("token");
        if (token == null || token.isBlank()) return url;
        if (url.startsWith("https://")) return "https://oauth2:" + token + "@" + url.substring("https://".length());
        if (url.startsWith("http://")) return "http://oauth2:" + token + "@" + url.substring("http://".length());
        return url;
    }

    /**
     * 脱敏：{@code https://oauth2:<token>@host} → {@code https://oauth2:***@host}。
     *
     * <p>clone / set-url 的地址里带的是个人 Git Token，而本地 agent.log 会被回传到服务端
     * （LOG_DATA），命令行的任何回显都必须先过这一层，否则等于把凭据写进服务端日志。
     */
    static String mask(String s) {
        if (s == null || s.isEmpty()) return s;
        return s.replaceAll("://([^/@\\s:]+):([^/@\\s]+)@", "://$1:***@");
    }

    /** 个人设置里的 git user.name / user.email 写入仓库级配置（不动全局） */
    private void applyGitIdentity(Path repo, List<String> trace) {
        String user = configStore.getGit().get("user");
        if (user != null && !user.isBlank()) exec(repo, 30, trace, "git", "config", "user.name", user);
        String email = configStore.getGit().get("email");
        if (email != null && !email.isBlank()) exec(repo, 30, trace, "git", "config", "user.email", email);
    }

    /** 注入模板变量：任务字段 + 客户端环境 */
    private Map<String, Object> buildVars(Map<String, Object> task) {
        Map<String, Object> vars = new LinkedHashMap<>();
        vars.put("issueCode", str(task.get("issueCode")));
        vars.put("issueTitle", str(task.get("issueTitle")));
        vars.put("node", str(task.get("node")));
        vars.put("kind", str(task.get("kind")));
        vars.put("branch", str(task.get("branch")));
        vars.put("repoUrl", str(task.get("repoUrl")));
        vars.put("workspace", config.workspace());
        vars.put("clientId", config.clientId());
        vars.put("step", String.valueOf(intOf(task.get("step"))));
        // 工具链以变量形式暴露给 Prompt 模板（{mavenHome} 等）
        vars.putAll(configStore.getToolchain());
        task.forEach(vars::putIfAbsent);
        return vars;
    }

    /** 供 argsTemplate 占位符 {prompt} {repo} {branch} {model} 使用的字符串变量 */
    private Map<String, String> cliVars(Map<String, Object> task, String backend, Path workdir) {
        Map<String, String> v = new LinkedHashMap<>();
        v.put("repo", workdir == null ? "" : workdir.toString());
        v.put("branch", str(task.get("branch")));
        v.put("model", configStore.modelOf(backend));
        v.put("workspace", config.workspace());
        v.put("issueCode", str(task.get("issueCode")));
        v.put("issueTitle", str(task.get("issueTitle")));
        v.put("node", str(task.get("node")));
        v.put("kind", str(task.get("kind")));
        v.put("clientId", config.clientId());
        v.put("step", String.valueOf(intOf(task.get("step"))));
        return v;
    }

    /**
     * 个人工具链下发：Maven bin 前置到 CLI 的 PATH（AgentCliRunner 识别 pathPrepend 键）。
     * 工作目录已在 prepareWorkspace 生效，这里只处理进程环境。
     */
    private void applyToolchain(Map<String, Object> agentCfg) {
        String mavenHome = configStore.getToolchain().get("mavenHome");
        if (mavenHome != null && !mavenHome.isBlank()) {
            agentCfg.put("pathPrepend", mavenHome.replaceAll("/+$", "") + "/bin");
        }
    }

    /** 服务端可要求最低客户端版本，低于则拒绝执行并回执说明原因 */
    private String versionGuard(Map<String, Object> agentCfg) {
        if (agentCfg == null) return null;
        String min = str(agentCfg.get("minVersion")).trim();
        if (min.isEmpty()) return null;
        String cur = AgentApplication.class.getPackage().getImplementationVersion();
        if (cur == null || cur.isBlank()) return null;
        if (compareVersion(cur, min) < 0) {
            return "客户端版本 " + cur + " 低于该后端要求的 " + min + "，已拒绝执行";
        }
        return null;
    }

    /** 语义化版本比较，缺失段按 0 处理 */
    private static int compareVersion(String a, String b) {
        String[] x = a.split("[.\\-]");
        String[] y = b.split("[.\\-]");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int xi = i < x.length ? intOf(x[i]) : 0;
            int yi = i < y.length ? intOf(y[i]) : 0;
            if (xi != yi) return Integer.compare(xi, yi);
        }
        return 0;
    }

    private int timeoutOf(Map<String, Object> task) {
        Object t = task.get("timeoutSec");
        return t == null ? DEFAULT_TIMEOUT_SEC : intOf(t);
    }

    private void reportResult(String instanceCode, int step, boolean success, String logText) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("instanceCode", instanceCode);
        r.put("step", step);
        r.put("success", success);
        r.put("log", logText);
        sender.accept("TASK_RESULT", r);
    }

    private void reportCallLog(String issueCode, String node, String kind, String backend, String model,
                               String renderedPrompt, boolean missingVars, long latencyMs) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("issueCode", issueCode);
        c.put("node", node);
        // 节点类型随日志上报：服务端据此挡住机械节点被误记为 AI 调用（旧版客户端无此字段，
        // 服务端会按节点名回查类型兜底）
        c.put("kind", kind);
        c.put("backend", backend);
        c.put("model", model);
        c.put("renderedPrompt", renderedPrompt);
        c.put("missingVars", missingVars);
        c.put("latencyMs", latencyMs);
        c.put("tokenUsed", 0);
        c.put("cost", 0);
        sender.accept("CALL_LOG", c);
    }

    /** 大产物走独立 unary 通道，不占用控制流 */
    private void uploadArtifact(String issueCode, String name, String kind, String content) {
        ManagedChannel ch = channelProvider.get();
        if (ch == null) {
            log.warn("未连接服务端，产物未回传: {}", name);
            return;
        }
        String body = content.length() > MAX_ARTIFACT_CHARS
                ? content.substring(0, MAX_ARTIFACT_CHARS) + "\n…（已截断）"
                : content;
        try {
            ArtifactResponse resp = AgentServiceGrpc.newBlockingStub(ch)
                    .withDeadlineAfter(30, TimeUnit.SECONDS)
                    .uploadArtifact(ArtifactRequest.newBuilder()
                            .setClientId(config.clientId())
                            .setIssueCode(issueCode)
                            .setName(name)
                            .setKind(kind)
                            .setContent(body)
                            .setSizeText(humanSize(body))
                            .build());
            log.info("产物回传完成: {} · ok={} · {}", name, resp.getOk(), resp.getMessage());
        } catch (Exception e) {
            log.warn("产物回传失败: {} - {}", name, e.getMessage());
        }
    }

    /** 执行本地命令，返回退出码；失败不抛异常，由调用方判断。命令与输出（脱敏后）追加进 trace */
    private int exec(Path dir, int timeoutSec, List<String> trace, String... argv) {
        return execOut(dir, timeoutSec, trace, argv).code();
    }

    private int exec(Path dir, int timeoutSec, List<String> trace, List<String> argv) {
        return execOut(dir, timeoutSec, trace, argv.toArray(new String[0])).code();
    }

    private CmdResult execOut(Path dir, int timeoutSec, List<String> trace, List<String> argv) {
        return execOut(dir, timeoutSec, trace, argv.toArray(new String[0]));
    }

    /** 同 {@link #exec}，但把输出一并带回，供失败原因判定使用 */
    private CmdResult execOut(Path dir, int timeoutSec, List<String> trace, String... argv) {
        // 戳取「命令开始」的时刻，不是结束：相邻两条命令的戳之差 = 前一条的耗时（含它之后的等待），
        // 结束时再打点会把耗时错记到下一档，读日志的人正好读反
        String ts = trace == null ? "" : "[" + LocalTime.now().format(TRACE_TS) + "] ";
        CmdResult r = run(dir, timeoutSec, argv);
        if (trace != null) {
            trace.add(ts + "$ " + mask(String.join(" ", argv)));
            if (!r.output().isBlank()) trace.add(cap(mask(r.output()), 4000));
        }
        // 超时（-1）已由 run() 打过「命令超时」，这里不重复刷日志：
        // 抖动链路下探测会重试很多轮，重复的告警会把真正有用的信息淹掉
        if (r.code() != 0 && r.code() != -1) {
            log.warn("命令退出码 {}: {}", r.code(), mask(String.join(" ", argv)));
        }
        return r;
    }

    /**
     * 在抖动的链路上把一件「需要网络」的事做成：先便宜地探到连通窗口，再动手；动手因网络原因失败就回到探测。
     *
     * <p>为什么值得为这件事单独写一个循环（2026-09-27 实测依据）：
     * <ol>
     *   <li>本机到 github 是**间歇性**可达 —— 22:20 curl 连 21s 超时，22:24 连续 6 次 ls-remote 全部 2s 内成功。
     *       原来的「3 次 × 90s + 固定 3s 间隔」只覆盖一个很短的时间窗，整段撞上断网窗口就判节点死刑。</li>
     *   <li>断网时 {@code git fetch} 零输出盲等满 90s，而 {@code http.lowSpeedLimit/lowSpeedTime}
     *       **在握手阶段根本不生效**；换成 20s 上限的 ls-remote 探测，同样的时间里能多试好几轮。</li>
     *   <li>探测走的是与 fetch **完全相同**的协议路径（TLS + 鉴权 + git 智能协议），
     *       不会出现「TCP 预检通过、fetch 紧接着被 reset」那种假阳性，还顺带验了 token。</li>
     * </ol>
     *
     * <p>不重试的情况：鉴权失败、仓库不存在、域名解析不了 —— 这些等多久都一样，直接如实返回，
     * 不让节点白白耗满预算。本地路径 / 未知协议、以及已配置 git http 代理的仓库不做探测，交给 git 判断。
     *
     * @param probeDir 跑探测命令的目录（仓库目录或工作区）
     * @param repoUrl  配置里的原始地址，仅用于日志与「是不是公网地址」的判断（可能不含 token）
     * @param url      实际访问的地址（含 token），探测与执行都用它
     * @param action   真正要执行的动作（clone / fetch）
     */
    private CmdResult withReachableNetwork(Path probeDir, String repoUrl, String url,
                                           List<String> trace, Supplier<CmdResult> action) {
        long deadline = System.currentTimeMillis() + GIT_NET_BUDGET_MS;
        String hp = hostPortOf(repoUrl);
        boolean probe = hp != null;
        if (hp == null) {
            trace.add("仓库地址是本地路径或未知协议，跳过连通性探测");
        } else if (proxyConfigured(probeDir)) {
            trace.add("已配置 git http 代理，跳过连通性探测（" + hp + "）");
            probe = false;
        }

        long backoff = 1500;
        for (int round = 1; ; round++) {
            // 等待可能长达 10 分钟，必须认「取消」：TaskExecutor.cancel() 会中断本线程，
            // 只认打断标记还不够 —— run() 捕获 InterruptedException 后要把它重新打上（见 run()）
            if (Thread.currentThread().isInterrupted()) {
                trace.add("任务被取消，停止等待远端");
                throw new IllegalStateException("任务已被取消");
            }
            if (probe) {
                CmdResult p = execOut(probeDir, PROBE_TIMEOUT_SEC, trace, gitNet("ls-remote", url, "HEAD"));
                if (p.code() != 0) {
                    if (isAuthFailure(p.output())) {
                        trace.add("远端可连通但鉴权失败，不再重试");
                        return p;
                    }
                    if (!retryableNetwork(p.code(), p.output())) {
                        trace.add("这不是网络抖动（" + gitReason(p) + "），不再重试");
                        return p;
                    }
                    if (System.currentTimeMillis() >= deadline) {
                        trace.add("已等待 " + (GIT_NET_BUDGET_MS / 1000) + "s，链路始终不可达，停止重试");
                        return p;
                    }
                    trace.add("第 " + round + " 次探测未通（" + gitReason(p) + "），" + (backoff / 1000) + "s 后重试");
                    sleepQuietly(backoff);
                    backoff = nextBackoff(backoff);
                    continue;
                }
                trace.add("远端可达（第 " + round + " 次探测通过）");
            }

            CmdResult last = action.get();
            if (last.code() == 0) return last;
            if (isAuthFailure(last.output())) {
                trace.add("鉴权失败，重试无意义，直接结束");
                return last;
            }
            if (!retryableNetwork(last.code(), last.output())) {
                trace.add("这不是网络抖动（" + gitReason(last) + "），不再重试");
                return last;
            }
            if (System.currentTimeMillis() >= deadline) {
                trace.add("已等待 " + (GIT_NET_BUDGET_MS / 1000) + "s 仍未成功，停止重试");
                return last;
            }
            trace.add("第 " + round + " 次失败（" + gitReason(last) + "），" + (backoff / 1000) + "s 后重试");
            sleepQuietly(backoff);
            backoff = nextBackoff(backoff);
        }
    }

    /** 退避：指数增长到上限，再叠一点抖动，别让每次重试都踩在同一个节拍上 */
    private static long nextBackoff(long prev) {
        return Math.min((long) (prev * 1.8) + ThreadLocalRandom.current().nextLong(0, 500), BACKOFF_MAX_MS + 500);
    }

    /**
     * 是否属于「等一会儿可能就好了」的网络故障。
     *
     * <p>鉴权失败 / 仓库不存在 / 域名解析不了不算 —— 这些条件不会因为等待而改变，
     * 让节点在它们身上耗满 5 分钟是最糟的体验。代理类错误同样不重试（配错了就是配错了）。
     */
    static boolean retryableNetwork(int code, String output) {
        if (code == -1) return true;                 // 超时哨兵：连接卡住或零进展被中断
        String low = output == null ? "" : output.toLowerCase();
        if (low.contains("could not resolve host")) return false;
        if (low.contains("repository not found") || low.contains("not found")) return false;
        return low.contains("connection reset") || low.contains("recv failure")
                || low.contains("could not connect") || low.contains("failed to connect")
                || low.contains("connection timed out") || low.contains("timed out")
                || low.contains("timeout") || low.contains("connection closed")
                || low.contains("early eof") || low.contains("empty reply")
                || low.contains("rpc failed");
    }

    /** git 里是否显式配了 http 代理（含按域名配的 `http.<url>.proxy`） */
    private boolean proxyConfigured(Path repo) {
        CmdResult r = run(repo, 20, "git", "config", "--get-regexp", "^http\\..*proxy$");
        return r.code() == 0 && !r.output().isBlank();
    }

    /**
     * 从仓库地址里取 {@code host:port}：https→443 / http→80 / ssh→22，显式端口优先。
     * 拿不准（本地路径、未知协议）返回 null，交给 git 自己报错。
     */
    static String hostPortOf(String url) {
        if (url == null || url.isBlank()) return null;
        String u = url.strip();
        String low = u.toLowerCase();
        String rest;
        int defPort;
        if (low.startsWith("https://")) {
            rest = u.substring(8);
            defPort = 443;
        } else if (low.startsWith("http://")) {
            rest = u.substring(7);
            defPort = 80;
        } else if (low.startsWith("ssh://")) {
            rest = u.substring(6);
            defPort = 22;
        } else if (!u.contains("://") && u.contains("@") && u.contains(":")) {
            // scp 风格 git@host:path
            String afterAt = u.substring(u.indexOf('@') + 1);
            int c = afterAt.indexOf(':');
            return c > 0 ? afterAt.substring(0, c) + ":22" : null;
        } else {
            return null;
        }

        int slash = rest.indexOf('/');
        String authority = slash < 0 ? rest : rest.substring(0, slash);
        int at = authority.lastIndexOf('@');
        if (at >= 0) authority = authority.substring(at + 1);   // 去掉 oauth2:<token>@
        if (authority.isBlank()) return null;
        if (authority.startsWith("[")) {                        // IPv6 字面量
            int end = authority.indexOf(']');
            if (end < 0) return null;
            String h = authority.substring(1, end);
            String p = authority.length() > end + 2 ? authority.substring(end + 2) : String.valueOf(defPort);
            return h + ":" + p;
        }
        int c = authority.indexOf(':');
        return c > 0 && c == authority.lastIndexOf(':') ? authority : authority + ":" + defPort;
    }

    /**
     * 把 git 的原始报错翻译成一句能照着排查的中文。
     *
     * <p>原来的「退出码 -1」是超时哨兵值，退回给服务端后既看不出是网络、是代理还是 token
     * 的问题，也看不出该找谁。这里做一次归类，并把 git 自己那句话带上。
     */
    static String gitReason(CmdResult r) {
        return gitReason(r.code(), r.output());
    }

    /** 与 {@link #gitReason(CmdResult)} 同义，用 (code, output) 调用便于离线校验归类结果 */
    static String gitReason(int code, String output) {
        String o = output == null ? "" : output;
        String low = o.toLowerCase();
        String head = firstLine(mask(o));
        if (code == -1) {
            return "命令超时（长时间无进展被中断）" + (head.isBlank() ? "" : "：" + head);
        }
        if (low.contains("connect tunnel failed") || low.contains("proxy") && low.contains("http")) {
            return "代理不可用（" + head + "）";
        }
        if (low.contains("could not resolve host")) return "域名解析失败（DNS）";
        if (low.contains("could not connect to server") || low.contains("failed to connect")) {
            return "连不上远端主机（网络不通/出口被拦）";
        }
        if (low.contains("connection reset") || low.contains("recv failure")
                || low.contains("connection closed") || low.contains("early eof")
                || low.contains("empty reply")) {
            return "连接被重置或中途断开（链路不稳 / 出口拦截）";
        }
        if (isAuthFailure(o)) {
            return low.contains("publickey") || low.contains("permission denied")
                    ? "SSH 鉴权失败（本机公钥未被远端接受）"
                    : "鉴权失败（检查个人设置里的 Git Token 是否失效）";
        }
        if (low.contains("repository not found")) return "仓库不存在或无权限";
        return "git 退出码 " + code + (head.isBlank() ? "（无输出）" : "：" + head);
    }

    /** 鉴权类错误：重试和换网络都没用，得先换凭据 */
    private static boolean isAuthFailure(String output) {
        String low = output == null ? "" : output.toLowerCase();
        return low.contains("authentication failed") || low.contains("invalid username or password")
                || low.contains("could not read username") || low.contains("permission denied")
                || low.contains("403");
    }

    /** 取一段文本的首行（截断），用于把 git 的报错压成一行 */
    static String firstLine(String s) {
        if (s == null) return "";
        String t = s.strip();
        int nl = t.indexOf('\n');
        if (nl > 0) t = t.substring(0, nl).strip();
        return t.length() > 200 ? t.substring(0, 200) + "…" : t;
    }

    /** 当前进程环境里继承来的代理（用于在 trace 里说明「为什么忽略了它」） */
    private static String inheritedProxy() {
        for (String k : PROXY_KEYS) {
            String v = System.getenv(k);
            if (v != null && !v.isBlank()) return k + "=" + v;
        }
        return "";
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 执行命令并取其输出（脱敏后）；失败返回空串。仅用于只读的信息采集 */
    private String capture(Path dir, String... argv) {
        return mask(run(dir, 30, argv).output());
    }

    private record CmdResult(int code, String output) {}

    private CmdResult run(Path dir, int timeoutSec, String... argv) {
        String shown = mask(String.join(" ", argv));
        try {
            List<String> cmd = new ArrayList<>();
            if (System.getProperty("os.name", "").toLowerCase().contains("win")) {
                cmd.add("cmd");
                cmd.add("/c");
            }
            cmd.addAll(Arrays.asList(argv));

            ProcessBuilder pb = new ProcessBuilder(cmd);
            if (dir != null && Files.isDirectory(dir)) pb.directory(dir.toFile());
            pb.redirectErrorStream(true);
            // 非交互环境：git 绝不允许停下来等凭证输入。
            // Windows 凭据管理器弹窗 / 终端 prompt 在无人值守的 agent 里都是「零输出无限挂起」，
            // 表现为节点一直「进行中」直到 fetch 超时（实测撞过）。
            pb.environment().put("GIT_TERMINAL_PROMPT", "0");
            pb.environment().put("GCM_INTERACTIVE", "never");
            // 继承来的代理一律摘掉：agent 常被带临时本地代理的会话拉起来，git 走它会静默挂死。
            // 需要代理时走 git 全局 http.proxy（见 PROXY_KEYS 注释）。
            PROXY_KEYS.forEach(pb.environment()::remove);
            // askpass 同理：被继承进来的 askpass 程序会顶掉 GIT_TERMINAL_PROMPT=0 直接弹窗挂住
            PROMPT_ENV_KEYS.forEach(pb.environment()::remove);
            Process p = pb.start();

            // StringBuffer：reader 线程与主线程并发读写，StringBuilder 的可见性没有保证，
            // 会让「超时被中断」的命令在日志里留下空输出（这正是排查这次 fetch 失败时踩到的）
            StringBuffer sb = new StringBuffer();
            Thread reader = new Thread(() -> {
                try (InputStream in = p.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                } catch (IOException ignored) {
                    // 进程结束时读流中断属预期
                }
            }, "talos-exec-reader");
            reader.setDaemon(true);
            reader.start();

            if (!p.waitFor(timeoutSec, TimeUnit.SECONDS)) {
                // 同 AgentCliRunner：cmd /c 包一层，必须连子进程一起杀，否则孤儿进程会继续改仓库
                p.descendants().forEach(ProcessHandle::destroyForcibly);
                p.destroyForcibly();
                // 先等 reader 把管道里剩下的字节读完，再取输出，否则超时场景永远只有一句「无输出」
                reader.join(1000);
                log.warn("命令超时: {}", shown);
                return new CmdResult(-1, sb.toString().strip());
            }
            reader.join(1500);
            return new CmdResult(p.exitValue(), sb.toString().strip());
        } catch (InterruptedException e) {
            // 取消任务时 cancel() 会中断本线程。必须把打断标记**重新打上**：
            // 否则异常一被吞掉，上层的等待循环就再也看不到「已被取消」，会一直等到预算耗尽。
            Thread.currentThread().interrupt();
            log.warn("命令被中断（任务取消）: {}", shown);
            return new CmdResult(-1, "");
        } catch (Exception e) {
            log.warn("命令执行异常: {} - {}", shown, e.getMessage());
            return new CmdResult(-1, "");
        }
    }

    /** 把多段输出拼成一条执行日志 */
    private static String merge(String a, String b) {
        String x = a == null ? "" : a.strip();
        String y = b == null ? "" : b.strip();
        if (x.isEmpty()) return y;
        if (y.isEmpty()) return x;
        return x + "\n\n" + y;
    }

    private static String trim(String s) {
        return cap(s == null ? "" : s.strip(), 8000);
    }

    private static String cap(String s, int max) {
        if (s == null) return "";
        return s.length() > max ? s.substring(0, max) + "\n…（已截断）" : s;
    }

    private static String humanSize(String s) {
        long bytes = s == null ? 0 : s.getBytes(StandardCharsets.UTF_8).length;
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / 1024.0 / 1024.0);
    }

    private static String str(Object o) {
        return o == null || "null".equals(String.valueOf(o)) ? "" : String.valueOf(o);
    }

    private static int intOf(Object o) {
        if (o == null) return 0;
        try {
            return (int) Double.parseDouble(String.valueOf(o));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
