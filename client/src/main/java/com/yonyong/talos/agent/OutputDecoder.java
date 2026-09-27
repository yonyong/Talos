package com.yonyong.talos.agent;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * 子进程输出解码：Windows 控制台程序（cmd / git / 认证类 CLI）输出本机 ANSI 编码，
 * 中文系统即 GBK；而 node 系 CLI（claude / codebuddy）输出 UTF-8。
 * 策略：先按 UTF-8 严格校验，含非法序列（GBK 特征）则回退 GBK 解码。
 * 注意必须整段解码：按 8KB 分块 new String 会把跨块的多字节字符切坏。
 */
final class OutputDecoder {

    private OutputDecoder() { }

    static String decode(ByteArrayOutputStream out) {
        byte[] bytes = out.toByteArray();
        if (bytes.length == 0) return "";
        if (isValidUtf8(bytes)) return new String(bytes, StandardCharsets.UTF_8);
        try {
            return new String(bytes, Charset.forName("GBK"));
        } catch (Exception e) {
            return new String(bytes, Charset.defaultCharset());
        }
    }

    /** 严格 UTF-8 校验：出现非法首字节 / 续字节 / 截断序列即视为非 UTF-8 */
    private static boolean isValidUtf8(byte[] b) {
        int i = 0;
        while (i < b.length) {
            int c = b[i] & 0xFF;
            if (c < 0x80) { i++; continue; }
            int need;
            if ((c & 0xE0) == 0xC0) need = 1;
            else if ((c & 0xF0) == 0xE0) need = 2;
            else if ((c & 0xF8) == 0xF0) need = 3;
            else return false;
            if (i + need >= b.length) return false;
            for (int k = 1; k <= need; k++) {
                if ((b[i + k] & 0xC0) != 0x80) return false;
            }
            i += need + 1;
        }
        return true;
    }
}
