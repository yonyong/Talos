package com.yonyong.talos.agent;

/**
 * 离线校验 TaskExecutor 里「网络故障归类 + 是否值得重试 + 地址解析 + 凭据脱敏 + Issue 目录名」五件事。
 * 断言用的都是真机实测 / 节点执行记录里出现过的原文，不是编的。
 *
 * <p>跑法（先打包客户端，classpath 直接用 fat jar；⚠️ javac/java 的路径**必须写 Windows 绝对路径**，
 * 配合 `MSYS_NO_PATHCONV=1` 时 `/d/tmp/...` 不会被转换，Windows 版 javac 找不到文件）：
 * <pre>
 * cd client &amp;&amp; mvn -o -q -DskipTests package
 * cd .. &amp;&amp; mkdir -p D:/tmp/grc &amp;&amp; cp tools/GitReasonCheck.java D:/tmp/grc/
 * javac -encoding UTF-8 -cp client/target/talos-agent.jar -d D:/tmp/grc/out D:/tmp/grc/GitReasonCheck.java
 * java -Dfile.encoding=UTF-8 -cp "client/target/talos-agent.jar;D:/tmp/grc/out" com.yonyong.talos.agent.GitReasonCheck
 * </pre>
 *
 * <p>为什么要有它：gitReason / retryableNetwork 的输出是用户在界面和执行记录里**唯一能看到**的东西，
 * 改错了没人会立刻发现；而它们的输入是字符串，天生适合离线断言。加新错误类型时先在这里补一条。
 */
public class GitReasonCheck {

    static int fail = 0;

    static void expect(String name, Object actual, Object want) {
        boolean ok = String.valueOf(actual).equals(String.valueOf(want));
        if (!ok) fail++;
        System.out.printf("%s %-46s 实际=%s%n", ok ? "[OK]" : "[FAIL]", name, actual);
        if (!ok) System.out.println("     期望=" + want);
    }

    public static void main(String[] args) {
        System.out.println("=== 报错归类 gitReason(code, output) ===");
        expect("连接被重置",
                TaskExecutor.gitReason(128, "fatal: unable to access 'https://github.com/yonyong/Talos.git/':"
                        + " Recv failure: Connection was reset"),
                "连接被重置或中途断开（链路不稳 / 出口拦截）");
        expect("连不上主机",
                TaskExecutor.gitReason(128, "fatal: unable to access 'https://github.com/yonyong/Talos.git/':"
                        + " Failed to connect to github.com:443 after 21059 ms: Could not connect to server"),
                "连不上远端主机（网络不通/出口被拦）");
        expect("超时哨兵(空输出)",
                TaskExecutor.gitReason(-1, ""),
                "命令超时（长时间无进展被中断）");
        expect("代理不可用",
                TaskExecutor.gitReason(128, "fatal: unable to access 'https://github.com/x/y.git/':"
                        + " CONNECT tunnel failed, response 502"),
                "代理不可用（fatal: unable to access 'https://github.com/x/y.git/': CONNECT tunnel failed, response 502）");
        expect("DNS 失败",
                TaskExecutor.gitReason(128, "ssh: Could not resolve hostname git.yonyong.dev: Name or service not known"
                        + "\nfatal: Could not read from remote repository."),
                "域名解析失败（DNS）");
        expect("SSH 公钥被拒",
                TaskExecutor.gitReason(255, "git@ssh.github.com: Permission denied (publickey)."
                        + "\nfatal: Could not read from remote repository."),
                "SSH 鉴权失败（本机公钥未被远端接受）");
        expect("Token 失效",
                TaskExecutor.gitReason(128, "remote: Invalid username or password.\n"
                        + "fatal: Authentication failed for 'https://github.com/x/y.git/'"),
                "鉴权失败（检查个人设置里的 Git Token 是否失效）");
        expect("仓库不存在",
                TaskExecutor.gitReason(128, "remote: Repository not found.\n"
                        + "fatal: repository 'https://github.com/x/y.git/' not found"),
                "仓库不存在或无权限");
        expect("token 脱敏",
                TaskExecutor.gitReason(128, "fatal: unable to access"
                        + " 'https://oauth2:ghp_SUPERSECRET123@github.com/yonyong/Talos.git/':"
                        + " Recv failure: Connection was reset"),
                "连接被重置或中途断开（链路不稳 / 出口拦截）");

        System.out.println();
        System.out.println("=== 是否值得等重试 retryableNetwork(code, output) ===");
        expect("连接被重置 → 等", TaskExecutor.retryableNetwork(128,
                "fatal: unable to access 'x': Recv failure: Connection was reset"), true);
        expect("连不上主机 → 等", TaskExecutor.retryableNetwork(128,
                "fatal: unable to access 'x': Failed to connect to github.com:443 after 21059 ms"), true);
        expect("超时哨兵 → 等", TaskExecutor.retryableNetwork(-1, ""), true);
        expect("RPC failed/curl 56 → 等", TaskExecutor.retryableNetwork(128,
                "error: RPC failed; curl 56 Recv failure: Connection was reset"), true);
        expect("DNS 不通 → 不等", TaskExecutor.retryableNetwork(128,
                "ssh: Could not resolve hostname git.yonyong.dev"), false);
        expect("仓库不存在 → 不等", TaskExecutor.retryableNetwork(128,
                "remote: Repository not found.\nfatal: repository 'x' not found"), false);
        expect("SSH 公钥被拒 → 不等", TaskExecutor.retryableNetwork(255,
                "git@ssh.github.com: Permission denied (publickey)."), false);
        expect("代理 502 → 不等", TaskExecutor.retryableNetwork(128,
                "fatal: unable to access 'x': CONNECT tunnel failed, response 502"), false);
        expect("token 失效 → 不等", TaskExecutor.retryableNetwork(128,
                "fatal: Authentication failed for 'x'"), false);

        System.out.println();
        System.out.println("=== 地址解析 hostPortOf(url)（决定探什么）===");
        expect("https 公网", TaskExecutor.hostPortOf("https://github.com/yonyong/Talos.git"), "github.com:443");
        expect("https 带 token", TaskExecutor.hostPortOf("https://oauth2:tok@github.com/yonyong/Talos.git"), "github.com:443");
        expect("ssh-over-443", TaskExecutor.hostPortOf("ssh://git@ssh.github.com:443/yonyong/Talos.git"), "ssh.github.com:443");
        expect("scp 风格内网", TaskExecutor.hostPortOf("git@git.yonyong.dev:quote/quote-service.git"), "git.yonyong.dev:22");
        expect("显式端口", TaskExecutor.hostPortOf("https://github.com:8443/x/y.git"), "github.com:8443");
        expect("本地路径→不探", TaskExecutor.hostPortOf("D:/tmp/demo.git"), "null");
        expect("file:// →不探", TaskExecutor.hostPortOf("file:///D:/tmp/demo.git"), "null");

        System.out.println();
        System.out.println("=== 凭据脱敏 mask ===");
        expect("oauth2 token", TaskExecutor.mask("https://oauth2:ghp_abc123@github.com/yonyong/Talos.git"),
                "https://oauth2:***@github.com/yonyong/Talos.git");

        System.out.println();
        System.out.println("=== Issue 目录名 issueSegment(issueCode)（它拼进文件系统路径，必须挡住穿越）===");
        expect("正常编号", TaskExecutor.issueSegment("REQ-2251"), "REQ-2251");
        expect("小写原样", TaskExecutor.issueSegment("req-2251"), "req-2251");
        expect("去首尾空白", TaskExecutor.issueSegment(" REQ-2251 "), "REQ-2251");
        expect("null → 兜底目录", TaskExecutor.issueSegment(null), "unassigned");
        expect("空串 → 兜底目录", TaskExecutor.issueSegment(""), "unassigned");
        expect("全空白 → 兜底目录", TaskExecutor.issueSegment("   "), "unassigned");
        expect("单点 → 兜底目录", TaskExecutor.issueSegment("."), "unassigned");
        expect("双点 → 兜底目录", TaskExecutor.issueSegment(".."), "unassigned");
        expect("路径穿越被压平", TaskExecutor.issueSegment("../../etc"), "..-..-etc");
        expect("反斜杠替换", TaskExecutor.issueSegment("REQ\\2251"), "REQ-2251");
        expect("盘符冒号替换", TaskExecutor.issueSegment("C:/x"), "C--x");
        expect("超长截到 64", TaskExecutor.issueSegment("A".repeat(70)), "A".repeat(64));

        System.out.println();
        System.out.println(fail == 0 ? "全部通过" : ("失败 " + fail + " 项"));
        if (fail > 0) System.exit(1);
    }
}
