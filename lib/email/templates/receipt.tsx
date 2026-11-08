type ReceiptTemplateInput = {
  customerName: string;
  saleNumber: string;
  total: number;
  paidAt: string;
};

export function renderReceiptEmailTemplate(input: ReceiptTemplateInput) {
  return `
  <div style="font-family: Arial, sans-serif; color: #111827; max-width: 520px; margin: 0 auto;">
    <h2 style="margin-bottom: 8px;">Artyx Digital Receipt</h2>
    <p style="margin-top: 0; color: #4b5563;">Thank you for your purchase, ${input.customerName}.</p>

    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Sale #</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 600;">${input.saleNumber}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Paid At</td>
        <td style="padding: 6px 0; text-align: right;">${input.paidAt}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #6b7280;">Total</td>
        <td style="padding: 6px 0; text-align: right; font-weight: 700;">BDT ${input.total.toFixed(2)}</td>
      </tr>
    </table>

    <p style="margin-top: 18px; font-size: 12px; color: #6b7280;">
      Keep this email as your purchase record.
    </p>
  </div>
  `;
}
