package com.yonyong.talos.service;

import com.yonyong.talos.controller.AuthException;
import com.yonyong.talos.entity.UserEntity;
import com.yonyong.talos.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 控制台登录：邮箱 + 邮件授权码。
 *
 * <p>流程：{@code 填邮箱 → 发授权码到该邮箱 → 回填授权码 → 校验通过签发会话 token}。
 * 邮箱必须命中 {@code t_user.email}（未在「用户管理」里登记邮箱的账号无法登录）。</p>
 *
 * <p>失败语义（全部 fail-safe，绝不因为服务端异常而放行）：</p>
 * <ul>
 *   <li>邮箱格式非法 / 未绑定账号 → 400</li>
 *   <li>授权码不确定、过期、试错超限 → 400 / 429，且不签发 token</li>
 *   <li>发信失败 → 502（宁可报错也不假装已发送）</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    /** 只校验「像不像邮箱」，不限定具体域名——域名属于企业部署信息，由数据（t_user.email）决定 */
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@,;]+@[^\\s@,;]+\\.[^\\s@,;]+$");

    /** 邮箱格式校验：用户管理页登记邮箱时复用同一套规则，避免两处判据漂移 */
    public static boolean validEmail(String email) {
        return email != null && EMAIL.matcher(email.trim()).matches();
    }

    /** 邮箱归一化：统一小写去空格，保证登录查找与唯一性校验一致 */
    public static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    private final UserRepository userRepository;
    private final LoginCodeService codeService;
    private final LoginMailService mailService;
    private final AuthSessionService sessionService;

    /** 仅供联调：开启后 send-code 会把授权码一并回传（生产必须为 false） */
    @Value("${talos.auth.expose-code:false}")
    private boolean exposeCode;

    /**
     * 发信前置：邮箱合法且已绑定账号。
     *
     * @param force true = 用户点了「重新发送」，要一封新邮件（我没收到邮件的情况）；
     *              false = 幂等取码：有效期内直接沿用上一条，不重复发信
     */
    public Map<String, Object> sendCode(String email, boolean force) {
        String addr = normalize(email);
        UserEntity user = requireUser(addr);

        LoginCodeService.Issued issued = codeService.prepare(addr, force);
        if (issued.fresh()) {
            try {
                mailService.sendLoginCode(addr, user.getName(), issued.code(), codeService.ttlSeconds());
            } catch (RuntimeException e) {
                // 发不出去就把码作废，别留一个用户永远拿不到的待校验码
                codeService.invalidate(addr);
                throw e;
            }
        } else {
            // 有效期内的码直接沿用：用户刷新登录页 / 来回切步骤时不该被 60 秒重发间隔堵住
            log.info("{} 仍有有效期内的授权码，沿用上一条，未重复发信", LoginMailService.mask(addr));
        }

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sent", true);
        m.put("resent", issued.fresh());
        m.put("email", LoginMailService.mask(addr));
        m.put("codeLength", codeService.codeLength());
        m.put("expiresIn", codeService.ttlSeconds());
        m.put("resendAfter", Math.max(0, issued.resendInMs() / 1000));
        if (exposeCode) m.put("devCode", issued.code());
        return m;
    }

    /** 校验授权码并签发会话 */
    public Map<String, Object> verify(String email, String code) {
        String addr = normalize(email);
        if (code == null || code.isBlank()) throw AuthException.badRequest("请输入邮件中的授权码");
        UserEntity user = requireUser(addr);
        codeService.verify(addr, code);

        AuthSessionService.Issued issued = sessionService.issue(user);
        log.info("登录成功：{} · {}（会话有效期 {} 小时）",
                user.getEmpNo(), LoginMailService.mask(addr), sessionService.ttlHours());

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("token", issued.token());
        m.put("expireAt", issued.expireAt().toString());
        m.put("ttlHours", sessionService.ttlHours());
        m.put("user", issued.session().toView());
        return m;
    }

    /** 当前登录用户（token 有效性由拦截器/服务双重校验） */
    public Map<String, Object> me(AuthSessionService.Session session) {
        // 会话里的快照可能已被管理员改动，这里以库里的实时数据为准
        UserEntity fresh = session.userId() == null ? null : userRepository.findById(session.userId()).orElse(null);
        if (fresh == null) {
            sessionService.revokeUser(session.userId());
            throw AuthException.unauthorized("账号已被删除，请重新登录");
        }
        return new AuthSessionService.Session(
                fresh.getId(), fresh.getEmpNo(), fresh.getName(), fresh.getRole(), fresh.getEmail(),
                fresh.getClientId(), fresh.getBizCodes(), session.expireAt()).toView();
    }

    public void logout(String token) {
        sessionService.revoke(token);
    }

    private UserEntity requireUser(String addr) {
        if (addr.isEmpty()) throw AuthException.badRequest("请输入登录邮箱");
        if (!validEmail(addr)) throw AuthException.badRequest("邮箱格式不正确：" + addr);
        UserEntity user = userRepository.findFirstByEmailIgnoreCase(addr);
        if (user == null) {
            throw AuthException.badRequest("该邮箱未绑定 Talos 账号，请联系管理员在「用户管理」中登记邮箱");
        }
        return user;
    }
}
