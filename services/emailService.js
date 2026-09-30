import nodemailer from "nodemailer";

/**
 * Dispatches an email notification to store owner or customer
 */
export const sendOrderAlertEmail = async ({ orderNumber, customerName, totalAmount, itemsCount, phone }) => {
  try {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass) return;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });

    const subject = `📦 NEW ORDER ALERT: #${orderNumber} (₦${Number(totalAmount).toLocaleString()})`;
    const html = `
      <div style="font-family: sans-serif; max-width: 560px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #166534; margin-top: 0;">📦 New Wholesale Order Received!</h2>
        <p>A new order has been placed on <strong>Vinoff Wholesales</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #64748b;">Order Number:</td><td style="font-weight: bold;">#${orderNumber}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Customer:</td><td style="font-weight: bold;">${customerName} (${phone || "No phone"})</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Carton Items:</td><td style="font-weight: bold;">${itemsCount} products</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Total Amount:</td><td style="font-weight: bold; font-size: 16px; color: #166534;">₦${Number(totalAmount).toLocaleString()}</td></tr>
        </table>
        <p style="font-size: 13px; color: #64748b;">Please verify payment or prepare warehouse dispatch at Kaduna Plaza 1, Trade Fair Complex.</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Vinoff Store Alert" <${user}>`,
      to: user,
      subject,
      html,
    });
  } catch (err) {
    console.error("[Email Alert Error]:", err.message);
  }
};

export default { sendOrderAlertEmail };
