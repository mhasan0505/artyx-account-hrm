export type ReceiptSmsPayload = {
  to: string;
  body: string;
};

import twilio from "twilio";

function createTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return twilio(accountSid, authToken);
}

export function buildReceiptSmsBody(input: {
  customerName: string;
  saleNumber: string;
  total: number;
  receiptUrl?: string;
}) {
  const base = `Thank you ${input.customerName}! Sale #${input.saleNumber} BDT ${input.total.toFixed(2)}.`;
  return input.receiptUrl ? `${base} Receipt: ${input.receiptUrl}` : base;
}

export function buildReceiptWhatsappBody(input: {
  customerName: string;
  saleNumber: string;
  total: number;
  paidAt: string;
  receiptUrl?: string;
}) {
  const lines = [
    `*Artyx Digital Invoice / Receipt*`,
    `Hello ${input.customerName},`,
    `Sale: *${input.saleNumber}*`,
    `Total: *BDT ${input.total.toFixed(2)}*`,
    `Paid At: ${input.paidAt}`,
  ];
  if (input.receiptUrl) lines.push(`Receipt: ${input.receiptUrl}`);
  return lines.join("\n");
}

export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("880")) digits = digits.slice(2);
  return digits.startsWith("0000");
}

export async function sendReceiptSms(payload: ReceiptSmsPayload) {
  if (isPlaceholderPhone(payload.to)) {
    return {
      sent: false,
      reason: "Placeholder phone number (starts with 0000), skipped sending receipt SMS",
    };
  }

  const client = createTwilioClient();
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!client || !fromNumber) {
    return {
      sent: false,
      reason: "Twilio environment variables are not fully configured",
    };
  }

  try {
    await client.messages.create({
      to: payload.to,
      from: fromNumber,
      body: payload.body,
    });

    return {
      sent: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown Twilio send error";
    return {
      sent: false,
      reason,
    };
  }
}

export async function sendReceiptWhatsapp(payload: ReceiptSmsPayload) {
  if (isPlaceholderPhone(payload.to)) {
    return {
      sent: false,
      reason: "Placeholder phone number (starts with 0000), skipped sending receipt WhatsApp",
    };
  }

  const client = createTwilioClient();
  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;

  if (!client || !whatsappFrom) {
    return {
      sent: false,
      reason:
        "Twilio WhatsApp is not fully configured. Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM",
    };
  }

  const normalizedTo = payload.to.startsWith("whatsapp:")
    ? payload.to
    : `whatsapp:${payload.to}`;

  const normalizedFrom = whatsappFrom.startsWith("whatsapp:")
    ? whatsappFrom
    : `whatsapp:${whatsappFrom}`;

  try {
    await client.messages.create({
      to: normalizedTo,
      from: normalizedFrom,
      body: payload.body,
    });

    return {
      sent: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown Twilio WhatsApp error";
    return {
      sent: false,
      reason,
    };
  }
}
