package com.yonyong.talos.agent;

import lombok.extern.slf4j.Slf4j;

import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本地运行日志尾部读取。
 *
 * 服务端下发 COMMAND PULL_LOG 时，客户端读取 logs/agent.log 的最后 N 行回传，
 * 控制台「查看日志」即可看到终端上的真实日志，不必登到机器上翻文件。
 *
 * 大文件只读取末尾 512KB，避免把整份日志读进内存。
 */
@Slf4j
public class AgentLogTail {

    private static final long TAIL_BYTES = 512 * 1024;

    private final AgentConfig config;

    public AgentLogTail(AgentConfig config) {
        this.config = config;
    }

    public Path logFile() {
        Path dir = Paths.get(config.logDir()).toAbsolutePath();
        Path plain = dir.resolve("agent.log");

        // 正常就是 logs/agent.log。但升级重启时旧的 cmd 可能还占着这个文件，
        // run-agent.bat 会退回写 logs/agent-<id>.log；此时若仍读 agent.log，
        // 控制台看到的永远是升级前的旧日志，所以取「最新的 agent*.log」。
        try (var files = Files.list(dir)) {
            Comparator<Path> byTimeThenPlain = Comparator
                    .comparingLong(AgentLogTail::lastModified)
                    .thenComparing(p -> p.getFileName().toString().equals("agent.log"));
            Path newest = files
                    .filter(Files::isRegularFile)
                    .filter(AgentLogTail::looksLikeAgentLog)
                    .max(byTimeThenPlain)
                    .orElse(null);
            if (newest != null) return newest;
        } catch (Exception e) {
            log.warn("选择日志文件失败，回退 agent.log：{}", e.getMessage());
        }
        return plain;
    }

    private static boolean looksLikeAgentLog(Path p) {
        String n = p.getFileName().toString().toLowerCase();
        return n.startsWith("agent") && n.endsWith(".log");
    }

    private static long lastModified(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis();
        } catch (Exception e) {
            return 0L;
        }
    }

    /** 返回 {file, exists, size, sizeText, lines[]} */
    public Map<String, Object> tail(int maxLines) {
        Map<String, Object> m = new LinkedHashMap<>();
        Path file = logFile();
        m.put("file", config.logDir().replace('\\', '/') + "/" + file.getFileName());
        m.put("host", hostName());

        if (!Files.isRegularFile(file)) {
            m.put("exists", false);
            m.put("size", 0L);
            m.put("sizeText", "0 B");
            m.put("lines", List.of());
            return m;
        }

        try {
            long size = Files.size(file);
            List<String> lines = decodeLines(readTail(file, size));
            if (lines.size() > maxLines) {
                lines = new ArrayList<>(lines.subList(lines.size() - maxLines, lines.size()));
            }
            m.put("exists", true);
            m.put("size", size);
            m.put("sizeText", humanSize(size));
            m.put("lines", lines);
        } catch (Exception e) {
            log.warn("读取本地日志失败: {}", e.getMessage());
            m.put("exists", true);
            m.put("size", 0L);
            m.put("sizeText", "—");
            m.put("lines", List.of("读取日志失败: " + e.getMessage()));
        }
        return m;
    }

    /** 文件大于 TAIL_BYTES 时只读末尾一段，并丢弃可能被截断的首行 */
    private byte[] readTail(Path file, long size) throws Exception {
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            if (size <= TAIL_BYTES) {
                byte[] buf = new byte[(int) size];
                raf.readFully(buf);
                return buf;
            }
            long from = size - TAIL_BYTES;
            raf.seek(from);
            byte[] buf = new byte[(int) TAIL_BYTES];
            raf.readFully(buf);
            // 从第一个换行处切开，避免把被截断的半行中文送上去
            int nl = -1;
            for (int i = 0; i < buf.length; i++) {
                if (buf[i] == '\n') { nl = i; break; }
            }
            if (nl < 0) return buf;
            byte[] out = new byte[buf.length - nl - 1];
            System.arraycopy(buf, nl + 1, out, 0, out.length);
            return out;
        }
    }

    /**
     * 按行解码。
     *
     * run-agent.bat 把 stdout/stderr 重定向进文件，编码取决于启动时的 JVM 字符集：
     * 中文 Windows 下默认是 GBK，UTF-8 环境下是 UTF-8。直接按 UTF-8 硬读会把
     * GBK 日志读成「����」。
     *
     * 逐行判断而不是整段判断，是因为同一个文件里可能两种编码混着（升级前 GBK、
     * 升级后 UTF-8），逐行回退能把历史行也读对，整段回退只能二选一。
     */
    private static List<String> decodeLines(byte[] bytes) {
        List<String> lines = new ArrayList<>();
        int start = 0;
        for (int i = 0; i <= bytes.length; i++) {
            if (i == bytes.length || bytes[i] == '\n') {
                int end = i;
                if (end > start && bytes[end - 1] == '\r') end--;
                if (end > start) {
                    byte[] line = new byte[end - start];
                    System.arraycopy(bytes, start, line, 0, line.length);
                    String text = decodeLine(line);
                    if (!text.isBlank()) lines.add(text);
                }
                start = i + 1;
            }
        }
        return lines;
    }

    /** 先按 UTF-8 严格解码，失败再退回平台默认字符集（GBK 日志同样能读对） */
    private static String decodeLine(byte[] bytes) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, Charset.defaultCharset());
        }
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / 1024.0 / 1024.0);
    }

    private static String hostName() {
        try {
            return java.net.InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "unknown";
        }
    }
}
