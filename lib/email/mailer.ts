export type ReceiptEmailPayload = {
  to: string;
  subject: string;
  html: string;
  saleNumber: string;
  text?: string;
};

import nodemailer from "nodemailer";

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export type PasswordResetEmailPayload = {
  to: string;
  name: string;
  resetUrl: string;
  otpCode: string;
  expiresMinutes: number;
};

export async function sendPasswordResetEmail(
  payload: PasswordResetEmailPayload
): Promise<{ sent: boolean; smtpConfigured: boolean; reason?: string }> {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;

  if (!transporter || !from) {
    return {
      sent: false,
      smtpConfigured: false,
      reason:
        "SMTP is not configured. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS",
    };
  }

  const safeName = payload.name || "Team Member";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 20px; background: #f8fafc; color: #0f172a;">
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px;">
        <h2 style="margin: 0 0 8px; font-size: 20px; color: #0f172a;">Reset Your Password</h2>
        <p style="margin: 0 0 18px; font-size: 14px; color: #475569; line-height: 1.6;">
          Hi ${safeName}, we received a request to reset your <strong>Artyx Digital</strong> office account password.
        </p>

        <div style="text-align: center; margin: 22px 0;">
          <a href="${payload.resetUrl}" style="display: inline-block; background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 26px; border-radius: 10px;">
            Reset Password
          </a>
        </div>

        <div style="margin: 22px 0; padding: 16px; background: #f1f5f9; border-radius: 10px; text-align: center;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 6px;">
            Or enter this 6-digit verification code
          </div>
          <div style="font-family: monospace; font-size: 26px; font-weight: 700; letter-spacing: 0.25em; color: #0f172a;">
            ${payload.otpCode}
          </div>
        </div>

        <p style="margin: 0 0 8px; font-size: 12px; color: #64748b; line-height: 1.5;">
          This link and verification code expire in <strong>${payload.expiresMinutes} minutes</strong>.
          If you did not request a password reset, you can safely ignore this email.
        </p>
        <p style="margin: 12px 0 0; font-size: 11px; color: #94a3b8; word-break: break-all;">
          Direct link: ${payload.resetUrl}
        </p>
      </div>
    </div>
  `;

  const text = [
    `Hi ${safeName},`,
    ``,
    `We received a request to reset your Artyx Digital account password.`,
    ``,
    `Reset link: ${payload.resetUrl}`,
    `6-digit verification code: ${payload.otpCode}`,
    ``,
    `This link and code expire in ${payload.expiresMinutes} minutes.`,
    `If you did not request this, you can safely ignore this email.`,
  ].join("\n");

  try {
    await transporter.sendMail({
      from,
      to: payload.to,
      subject: "Reset your Artyx Digital password",
      html,
      text,
    });
    return { sent: true, smtpConfigured: true };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown SMTP send error";
    return { sent: false, smtpConfigured: true, reason };
  }
}

export async function queueReceiptEmail(payload: ReceiptEmailPayload) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;

  if (!transporter || !from) {
    return {
      queued: false,
      reason:
        "SMTP is not configured. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS",
    };
  }

  try {
    await transporter.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text:
        payload.text ??
        `Receipt ${payload.saleNumber} is attached in HTML format. Please open this email in an HTML-capable client.`,
    });

    return {
      queued: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown SMTP send error";
    return {
      queued: false,
      reason,
    };
  }
}
