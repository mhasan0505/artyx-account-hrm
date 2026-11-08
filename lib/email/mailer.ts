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
