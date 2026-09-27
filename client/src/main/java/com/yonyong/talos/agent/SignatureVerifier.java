package com.yonyong.talos.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 服务端指令签名校验。
 *
 * 服务端 DispatchService 对 TASK_DISPATCH 的报文（不含 signature 字段）做 HMAC-SHA256，
 * 客户端用同一密钥复算比对，防止伪造任务。
 * 未配置 client.signSecret 时不校验（保持与历史行为兼容）。
 */
@Slf4j
public class SignatureVerifier {

    private static final ObjectMapper OM = new ObjectMapper();

    /** 返回 true 表示放行；false 表示签名不匹配应拒绝执行 */
    @SuppressWarnings("unchecked")
    public static boolean verify(String payloadJson, String signature, String secret) {
        if (secret == null || secret.isBlank()) return true;
        if (signature == null || signature.isBlank() || "null".equals(signature)) {
            log.warn("已配置 signSecret 但报文未携带 signature");
            return false;
        }
        try {
            Map<String, Object> map = OM.readValue(payloadJson, LinkedHashMap.class);
            map.remove("signature");
            String canonical = OM.writeValueAsString(map);
            return constantTimeEquals(hmac(canonical, secret), signature);
        } catch (Exception e) {
            log.warn("签名校验异常: {}", e.getMessage());
            return false;
        }
    }

    private static String hmac(String data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC 计算失败", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] x = a.getBytes(StandardCharsets.UTF_8);
        byte[] y = b.getBytes(StandardCharsets.UTF_8);
        if (x.length != y.length) return false;
        int diff = 0;
        for (int i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
        return diff == 0;
    }

    private SignatureVerifier() { }
}
