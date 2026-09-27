import { EMAIL_ACTION_TTL_MS } from './mailer.js';

export type OutboundEmailKind = 'register_verify' | 'email_change_verify' | 'password_reset';

export interface OutboundEmailContent {
  subject: string;
  text: string;
  html: string;
}

const TTL_MINUTES = Math.round(EMAIL_ACTION_TTL_MS / 60_000);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildContent(input: {
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  ignoreHint: string;
}): OutboundEmailContent {
  const safeUrl = escapeHtml(input.actionUrl);
  const text = [
    '尊敬的用户，您好：',
    '',
    input.intro,
    '',
    `${input.actionLabel}：`,
    input.actionUrl,
    '',
    `此链接将在 ${TTL_MINUTES} 分钟内有效。`,
    input.ignoreHint,
    '',
    '——',
    'Enterprise Skill Library（ESL）'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <div style="font-size:18px;font-weight:600;color:#111827;">${escapeHtml(input.heading)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0 28px;font-size:14px;line-height:1.7;color:#374151;">
              <p style="margin:0 0 12px 0;">尊敬的用户，您好：</p>
              <p style="margin:0 0 20px 0;">${escapeHtml(input.intro)}</p>
              <p style="margin:0 0 24px 0;text-align:center;">
                <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(input.actionLabel)}</a>
              </p>
              <p style="margin:0 0 8px 0;">若按钮无法点击，请将以下链接复制到浏览器地址栏打开：</p>
              <p style="margin:0 0 20px 0;word-break:break-all;"><a href="${safeUrl}" style="color:#2563eb;text-decoration:underline;">${safeUrl}</a></p>
              <p style="margin:0 0 8px 0;">此链接将在 ${TTL_MINUTES} 分钟内有效。</p>
              <p style="margin:0;">${escapeHtml(input.ignoreHint)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;font-size:12px;line-height:1.6;color:#6b7280;border-top:1px solid #eef2f7;">
              Enterprise Skill Library（ESL）
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: input.subject, text, html };
}

export function buildOutboundEmail(kind: OutboundEmailKind, actionUrl: string): OutboundEmailContent {
  switch (kind) {
    case 'register_verify':
      return buildContent({
        subject: '请验证您的 ESL 账号邮箱',
        heading: '邮箱验证',
        intro: '感谢您注册 Enterprise Skill Library（ESL）。请点击下方按钮完成邮箱验证，以激活您的账号。',
        actionLabel: '验证邮箱并激活账号',
        actionUrl,
        ignoreHint: '如非本人操作，请忽略本邮件。'
      });
    case 'email_change_verify':
      return buildContent({
        subject: '请确认您的 ESL 新邮箱',
        heading: '邮箱变更确认',
        intro: '我们收到了变更 ESL 账号邮箱的请求。请点击下方按钮确认新邮箱地址。',
        actionLabel: '确认新邮箱',
        actionUrl,
        ignoreHint: '如非本人操作，请忽略本邮件，您的邮箱不会被更改。'
      });
    case 'password_reset':
      return buildContent({
        subject: '重置您的 ESL 账号密码',
        heading: '密码重置',
        intro: '我们收到了重置 ESL 账号密码的请求。请点击下方按钮设置新密码。',
        actionLabel: '重置密码',
        actionUrl,
        ignoreHint: '如非本人操作，请忽略本邮件，您的密码不会被更改。'
      });
  }
}
