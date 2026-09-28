package com.yonyong.talos.service;

import com.yonyong.talos.controller.AuthException;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

/**
 * 登录授权码邮件下发。
 *
 * <p>发件人取自配置（{@code talos.auth.mail-from}，留空则用 {@code spring.mail.username}）——
 * 代码里不出现任何具体邮箱地址，换邮箱只改配置不动代码。</p>
 *
 * <p>与参考实现的一处差异：发信失败**不吞掉**。收不到授权码就等于登不进去，
 * 静默降级只会让人对着「授权码错误」反复重试，这里直接把原因抛给前端。</p>
 */
@Slf4j
@Service
public class LoginMailService {

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String smtpUsername;

    @Value("${talos.auth.mail-from:}")
    private String configuredFrom;

    @Value("${talos.auth.expose-code:false}")
    private boolean exposeCode;

    public LoginMailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    /** 发信是否可用（用于启动自检与接口前置校验） */
    public boolean configured() {
        return from() != null;
    }

    /**
     * 发送登录授权码。
     *
     * @throws AuthException 502 未配置发信邮箱或 SMTP 发送失败
     */
    public void sendLoginCode(String to, String userName, String code, int ttlSeconds) {
        String from = from();
        if (from == null) {
            throw AuthException.mailFailed("服务端未配置授权码发信邮箱（spring.mail.username 或 talos.auth.mail-from），无法发送授权码");
        }
        String who = userName == null || userName.isBlank() ? "用户" : userName;
        String minutes = ttlSeconds % 60 == 0 ? (ttlSeconds / 60) + " 分钟" : ttlSeconds + " 秒";
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(from);
            helper.setTo(to);
            // 授权码放主题里：收件箱列表就能直接看到，不必点开
            helper.setSubject("【" + code + "】Talos 登录授权码");
            helper.setText(buildHtml(who, code, ttlSeconds, minutes), true);
            mailSender.send(message);
            if (exposeCode) {
                log.warn("已向 {} 下发登录授权码 {}（expose-code 已开启，仅供联调）", mask(to), code);
            } else {
                log.info("已向 {} 下发登录授权码（{} 内有效）", mask(to), minutes);
            }
        } catch (MailException e) {
            log.warn("登录授权码邮件发送失败：to={} err={}", mask(to), e.getMessage());
            throw AuthException.mailFailed("授权码邮件发送失败：" + rootMessage(e) + "（请检查服务端 SMTP 配置）");
        } catch (Exception e) {
            log.warn("登录授权码邮件组装失败：to={} err={}", mask(to), e.getMessage());
            throw AuthException.mailFailed("授权码邮件组装失败：" + rootMessage(e));
        }
    }

    private String from() {
        String f = configuredFrom;
        if (f == null || f.isBlank()) f = smtpUsername;
        return f == null || f.isBlank() ? null : f.trim();
    }

    /** 邮件地址打码，日志里不留全量收件人 */
    static String mask(String email) {
        if (email == null || email.isBlank()) return "(空)";
        int at = email.indexOf('@');
        if (at <= 1) return "***" + (at < 0 ? "" : email.substring(at));
        return email.charAt(0) + "***" + email.substring(at);
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        return m == null || m.isBlank() ? t.getClass().getSimpleName() : m.split("\n")[0];
    }

    private String buildHtml(String who, String code, int ttlSeconds, String minutes) {
        return """
            <div style="font-family:-apple-system,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;background:#f6f7f9;border-radius:16px;">
              <div style="font-size:17px;font-weight:650;color:#18181b;letter-spacing:-0.01em;">Talos 控制台登录</div>
              <p style="color:#52525b;font-size:14px;line-height:1.65;margin:14px 0 0;">
                你好 <strong style="color:#18181b;">%s</strong>，你正在登录 Talos 研发流程平台。本次登录授权码：
              </p>
              <div style="display:inline-block;letter-spacing:6px;font-size:30px;font-weight:700;color:#18181b;
                          background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:16px 22px;margin:14px 0 12px;">
                %s
              </div>
              <p style="color:#71717a;font-size:13px;margin:0;">
                该授权码为一次性使用，<strong>%s</strong>后失效（约 %d 秒）。
              </p>
              <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0 14px;" />
              <p style="color:#a1a1aa;font-size:12px;margin:0;line-height:1.6;">
                如果不是你本人操作，请忽略本邮件；请勿把授权码转发给任何人。
              </p>
            </div>
            """.formatted(who, code, minutes, ttlSeconds);
    }
}
