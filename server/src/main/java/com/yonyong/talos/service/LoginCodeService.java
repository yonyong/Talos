package com.yonyong.talos.service;

import com.yonyong.talos.controller.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 登录授权码（一次性，存内存）。
 *
 * <p>与身份验证器（TOTP）无关：登录时由服务端生成一串数字授权码，邮件下发给用户，
 * 有效期默认 3 分钟，校验通过即一次性消费。</p>
 *
 * <p>三道限流，避免被当成免费的邮件触发器：</p>
 * <ol>
 *   <li>同一邮箱两次发信间隔 ≥ resendInterval（默认 60s）</li>
 *   <li>同一邮箱每小时最多 maxSendsPerHour 次</li>
 *   <li>单个授权码最多试错 maxVerifyAttempts 次，超过即作废（须重新获取）</li>
 * </ol>
 *
 * 存内存即可：重启后所有人重新登录一次，反而比遗留脏令牌更干净。
 */
@Service
public class LoginCodeService {

    private final SecureRandom random = new SecureRandom();
    /** 待校验的授权码，key = 小写邮箱；被消费 / 过期即删除 */
    private final Map<String, Entry> codes = new ConcurrentHashMap<>();
    /**
     * 发信限流计数，key = 小写邮箱。
     * 必须与 {@link #codes} 分开存：授权码一被消费（或过期、作废）就要删掉，
     * 若把计数挂在同一个对象上，删码就等于把「重发间隔」和「每小时上限」一起清零 ——
     * 只要发一次码再用掉，就能无限发信。
     */
    private final Map<String, Rate> rates = new ConcurrentHashMap<>();

    @Value("${talos.auth.code-length:8}")
    private int codeLength;

    @Value("${talos.auth.code-ttl-seconds:180}")
    private int ttlSeconds;

    @Value("${talos.auth.resend-interval-seconds:60}")
    private int resendIntervalSeconds;

    @Value("${talos.auth.max-sends-per-hour:10}")
    private int maxSendsPerHour;

    @Value("${talos.auth.max-verify-attempts:5}")
    private int maxVerifyAttempts;

    public int ttlSeconds() {
        return ttlSeconds;
    }

    public int resendIntervalSeconds() {
        return resendIntervalSeconds;
    }

    public int codeLength() {
        return codeLength;
    }

    /**
     * 生成新授权码（覆盖该邮箱的旧码），并在限流范围内登记本次发信。
     *
     * @throws AuthException 429 发送过于频繁 / 超出小时配额
     */
    /**
     * 发信结果。
     *
     * @param code       当前有效的授权码
     * @param fresh      true = 本次真的发了新邮件；false = 沿用了有效期内的旧码（不重复发信）
     * @param resendInMs 距离下一次可发信还有多少毫秒（0 = 现在就能发）
     */
    public record Issued(String code, boolean fresh, long resendInMs) {
    }

    /**
     * 准备一个可用授权码：有效期内的码直接沿用（不重发、不消耗配额），
     * 否则在限流范围内生成新码并由调用方发信。
     *
     * <p>沿用而不是报错，是因为真实场景里用户会刷新登录页、或在两步之间来回切换 ——
     * 此时「你刚发过，请等 60 秒」把人堵在第一步，但邮箱里其实躺着一条还能用的码。
     * 注意沿用**不消耗**发信配额，所以这个分支不会被用来刷邮件。</p>
     *
     * @param force true = 用户点了「重新发送」，明确要一封新邮件（仍受重发间隔与小时配额约束），
     *              用于「我没收到邮件」；false = 幂等地取一个可用码（有效期内直接沿用）
     * @throws AuthException 429 确实需要新码但发信过频 / 超出小时配额
     */
    public synchronized Issued prepare(String email, boolean force) {
        String key = normalize(email);
        Instant now = Instant.now();

        Rate rate = rates.get(key);
        boolean windowFresh = rate != null && rate.hourStart.plus(Duration.ofHours(1)).isAfter(now);
        long resendInMs = windowFresh
                ? Math.max(0, resendIntervalSeconds * 1000L
                        - Duration.between(rate.lastSentAt, now).toMillis())
                : 0;

        Entry pending = codes.get(key);
        if (pending != null && now.isBefore(pending.expireAt)) {
            if (!force) return new Issued(pending.code, false, resendInMs);
        } else if (pending != null) {
            codes.remove(key); // 过期即清
        }

        if (windowFresh) {
            if (resendInMs > 0) {
                throw AuthException.tooMany("授权码刚刚发送过，请 "
                        + (resendInMs / 1000 + 1) + " 秒后重试");
            }
            if (rate.hourCount >= maxSendsPerHour) {
                throw AuthException.tooMany("该邮箱一小时内已发送 " + rate.hourCount
                        + " 次授权码，已达上限，请稍后再试");
            }
        } else {
            rate = new Rate(now);
            rates.put(key, rate);
            if (rates.size() > 1000) purgeRates(now);
        }

        Entry entry = new Entry();
        entry.code = randomCode();
        entry.expireAt = now.plusSeconds(ttlSeconds);
        entry.attempts = 0;
        codes.put(key, entry);

        rate.lastSentAt = now;
        rate.hourCount++;
        return new Issued(entry.code, true, resendIntervalSeconds * 1000L);
    }

    /**
     * 校验并一次性消费授权码。
     *
     * @throws AuthException 400 未获取 / 已过期 / 不正确；429 试错次数超限
     */
    public synchronized void verify(String email, String code) {
        String key = normalize(email);
        Entry entry = codes.get(key);
        if (entry == null) {
            throw AuthException.badRequest("尚未获取授权码，请先点击「发送授权码」");
        }
        if (Instant.now().isAfter(entry.expireAt)) {
            codes.remove(key);
            throw AuthException.badRequest("授权码已过期，请重新获取");
        }
        entry.attempts++;
        if (entry.attempts > maxVerifyAttempts) {
            codes.remove(key);
            throw AuthException.tooMany("授权码错误次数过多，已作废，请重新获取");
        }
        if (!entry.code.equals(code == null ? "" : code.trim())) {
            int left = Math.max(0, maxVerifyAttempts - entry.attempts);
            throw AuthException.badRequest("授权码不正确，还可尝试 " + left + " 次");
        }
        codes.remove(key);
    }

    /** 作废某邮箱的待校验授权码（发信失败、账号变更时清理）；不影响发信限流计数 */
    public void invalidate(String email) {
        codes.remove(normalize(email));
    }

    /** 清掉早已过窗口的限流记录：一个邮箱一条，正常量级极小，只在异常增长时兜底 */
    private void purgeRates(Instant now) {
        rates.entrySet().removeIf(e -> !e.getValue().hourStart.plus(Duration.ofHours(2)).isAfter(now));
    }

    /** 授权码位数的数字串，首位非 0，避免出现被前端当成空值的前导零 */
    private String randomCode() {
        int len = Math.max(4, Math.min(12, codeLength));
        StringBuilder sb = new StringBuilder(len);
        sb.append(1 + random.nextInt(9));
        for (int i = 1; i < len; i++) {
            sb.append(random.nextInt(10));
        }
        return sb.toString();
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    /** 单个邮箱的待校验授权码：校验通过 / 过期 / 试错超限即整条删除 */
    private static final class Entry {
        String code;
        Instant expireAt;
        int attempts;
    }

    /** 单个邮箱的发信限流：一小时窗口内的次数 + 上次发信时刻 */
    private static final class Rate {
        final Instant hourStart;
        Instant lastSentAt;
        int hourCount;

        Rate(Instant hourStart) {
            this.hourStart = hourStart;
            this.lastSentAt = hourStart;
            this.hourCount = 0;
        }
    }
}
