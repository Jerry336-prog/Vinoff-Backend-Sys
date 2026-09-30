import nodemailer from "nodemailer";
import User from "../models/User.js";

/**
 * Sends email via Resend HTTP API (Port 443 - works on Render Free Tier without SMTP blocks)
 */
const sendViaResend = async ({ to, subject, html }) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return null;

  const senderEmail = (process.env.EMAIL_FROM || "Vinoff Wholesales <onboarding@resend.dev>").trim();
  const recipientList = Array.isArray(to) ? to : [to];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderEmail,
      to: recipientList,
      subject,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error?.message || "Resend API returned an error");
  }

  return { success: true, messageId: data.id, provider: "Resend (HTTPS)" };
};

/**
 * Sends email via Brevo HTTP API (Port 443 - works on Render Free Tier without SMTP blocks)
 */
const sendViaBrevo = async ({ to, subject, html }) => {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  if (!apiKey) return null;

  const senderEmail = (process.env.EMAIL_USER || "info@vinoff.com").trim();
  const recipientList = (Array.isArray(to) ? to : [to]).map((email) => ({ email }));

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Vinoff Wholesales", email: senderEmail },
      to: recipientList,
      subject,
      htmlContent: html,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Brevo API returned an error");
  }

  return { success: true, messageId: data.messageId, provider: "Brevo (HTTPS)" };
};

/**
 * Creates and returns a verified Nodemailer transporter for Gmail / SMTP
 */
const getTransporter = () => {
  const user = (process.env.EMAIL_USER || "").trim();
  const pass = (process.env.EMAIL_PASS || "").replace(/\s+/g, "");

  if (!user || !pass) {
    return null;
  }

  return {
    transporter: nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 8000,
    }),
    user,
  };
};

/**
 * Core dispatcher: tries HTTPS APIs first (port 443, Render-compatible), then falls back to SMTP
 */
export const dispatchEmail = async ({ to, subject, html }) => {
  // 1. Try Resend HTTPS API (port 443, never blocked by Render)
  if (process.env.RESEND_API_KEY) {
    try {
      const resendResult = await sendViaResend({ to, subject, html });
      if (resendResult) return resendResult;
    } catch (resendErr) {
      console.error("[Email Resend Error]:", resendErr.message);
    }
  }

  // 2. Try Brevo HTTPS API (port 443, never blocked by Render)
  if (process.env.BREVO_API_KEY) {
    try {
      const brevoResult = await sendViaBrevo({ to, subject, html });
      if (brevoResult) return brevoResult;
    } catch (brevoErr) {
      console.error("[Email Brevo Error]:", brevoErr.message);
    }
  }

  // 3. Fallback to Nodemailer SMTP (Gmail)
  const config = getTransporter();
  if (!config) {
    return {
      success: false,
      reason:
        "No email credentials configured. Please set EMAIL_USER & EMAIL_PASS (or RESEND_API_KEY) in Render Environment Variables.",
    };
  }

  const { transporter, user } = config;
  const recipientList = Array.isArray(to) ? to : [to];

  try {
    const sendPromise = transporter.sendMail({
      from: `"Vinoff Wholesale Orders" <${user}>`,
      to: recipientList.join(", "),
      subject,
      html,
    });

    const info = await Promise.race([
      sendPromise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "SMTP connection timed out. If you are on Render Free tier, Render blocks outbound SMTP ports (25, 465, 587). Please add a free RESEND_API_KEY in Render Environment Variables to send emails via HTTPS port 443."
              )
            ),
          7000
        )
      ),
    ]);

    return { success: true, messageId: info.messageId, provider: "Gmail SMTP" };
  } catch (err) {
    console.error("[Email SMTP Error]:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Dispatches an email notification to store owner and ALL active admin accounts
 * Only accounts that currently have admin or superadmin roles will receive this notification.
 * Demoted accounts automatically stop receiving alerts.
 */
export const sendOrderAlertEmail = async ({
  orderNumber,
  customerName,
  totalAmount,
  itemsCount,
  phone,
  items = [],
}) => {
  try {
    // Dynamically retrieve all users with admin or superadmin role right now
    const activeAdmins = await User.find({
      role: { $in: ["admin", "superadmin"] },
      status: { $ne: "blocked" },
    }).select("email");

    const adminEmails = activeAdmins
      .map((a) => a.email && a.email.toLowerCase().trim())
      .filter(Boolean);

    const defaultOwner = (process.env.EMAIL_USER || "").trim();
    const recipientEmails = Array.from(new Set([defaultOwner, ...adminEmails].filter(Boolean)));

    if (recipientEmails.length === 0) {
      return { success: false, reason: "No recipient admin emails found in database" };
    }

    const itemsRows =
      Array.isArray(items) && items.length > 0
        ? items
            .map(
              (it) => `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 4px; font-size: 13px; color: #1e293b;">${it.name || "Product"}</td>
            <td style="padding: 8px 4px; font-size: 13px; text-align: center; color: #475569;">${it.quantity} ${it.unitType || "ctns"}</td>
            <td style="padding: 8px 4px; font-size: 13px; text-align: right; font-weight: bold; color: #1e293b;">₦${Number((it.price || 0) * (it.quantity || 1)).toLocaleString()}</td>
          </tr>`
            )
            .join("")
        : `<tr><td colspan="3" style="padding: 8px 4px; color: #64748b;">${itemsCount || 1} product(s) ordered</td></tr>`;

    const clientUrl = (process.env.CLIENT_URL || "https://vinoff-web.vercel.app").replace(/\/+$/, "");
    const orderPageUrl = `${clientUrl}/orders/${orderNumber}`;
    const adminDeskUrl = `${clientUrl}/admin/orders?order=${orderNumber}`;

    const subject = `📦 NEW ORDER ALERT: #${orderNumber} (₦${Number(totalAmount).toLocaleString()})`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="text-align: center; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
          <h2 style="color: #15803d; margin: 0; font-size: 20px;">📦 New Wholesale Order Received!</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Vinoff Wholesales Order Notification</p>
        </div>

        <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border-radius: 12px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Order Number:</td>
              <td style="padding: 6px 0; font-weight: bold; font-size: 14px; text-align: right; color: #0f172a;">#${orderNumber}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Customer:</td>
              <td style="padding: 6px 0; font-weight: bold; font-size: 13px; text-align: right; color: #0f172a;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Customer Phone:</td>
              <td style="padding: 6px 0; font-weight: bold; font-size: 13px; text-align: right; color: #0f172a;">${phone || "Not specified"}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Total Amount:</td>
              <td style="padding: 6px 0; font-weight: 800; font-size: 18px; text-align: right; color: #15803d;">₦${Number(totalAmount).toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div style="margin: 20px 0;">
          <h4 style="margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #475569; letter-spacing: 0.5px;">Order Items</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 12px;">
                <th style="padding: 6px 4px; text-align: left;">Item</th>
                <th style="padding: 6px 4px; text-align: center;">Qty</th>
                <th style="padding: 6px 4px; text-align: right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
        </div>

        <div style="margin: 28px 0; text-align: center;">
          <a href="${orderPageUrl}" style="display: inline-block; background-color: #15803d; color: #ffffff; text-decoration: none; padding: 13px 26px; border-radius: 12px; font-weight: 800; font-size: 14px; margin-bottom: 8px;">
            View Order #${orderNumber} &rarr;
          </a>
          <br/>
          <a href="${adminDeskUrl}" style="display: inline-block; background-color: #f1f5f9; color: #1e293b; text-decoration: none; padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 13px; border: 1px solid #cbd5e1;">
            Open Admin Order Desk
          </a>
        </div>

        <div style="padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="font-size: 12px; color: #64748b; margin: 0;">
            Kaduna Plaza 1, Block A, Shop 22, Int’l Centre for Commerce, Trade-Fair Complex, Lagos.
          </p>
        </div>
      </div>
    `;

    const result = await dispatchEmail({
      to: recipientEmails,
      subject,
      html,
    });

    if (result.success) {
      console.log(
        `[Order Alert Sent via ${result.provider}]: Dispatched to ${recipientEmails.length} admin(s) (${recipientEmails.join(", ")}) [ID: ${result.messageId}]`
      );
      return { success: true, messageId: result.messageId, recipients: recipientEmails, provider: result.provider };
    } else {
      return result;
    }
  } catch (err) {
    console.error("[Email Alert Error]:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Dispatches a welcoming email to newly registered customers on account creation
 */
export const sendWelcomeEmail = async ({ email, firstName, lastName }) => {
  try {
    const recipient = (email || "").toLowerCase().trim();
    if (!recipient) return { success: false, reason: "Missing recipient email" };

    const clientUrl = (process.env.CLIENT_URL || "https://vinoff-web.vercel.app").replace(/\/+$/, "");
    const catalogUrl = `${clientUrl}/shop`;

    const name = firstName ? `${firstName} ${lastName || ""}`.trim() : "Valued Customer";
    const subject = `👋 Welcome to Vinoff Wholesales Ltd, ${firstName || "Partner"}!`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
          <h1 style="color: #15803d; margin: 0; font-size: 24px; font-weight: 800;">VINOFF WHOLESALES</h1>
          <p style="color: #64748b; font-size: 13px; margin: 6px 0 0;">Commercial Toiletries, Sanitizers &amp; Industrial Detergents</p>
        </div>

        <div style="margin: 24px 0;">
          <h2 style="color: #0f172a; font-size: 18px; margin-top: 0;">Welcome aboard, ${name}! 🎉</h2>
          <p style="color: #334155; font-size: 14px; line-height: 1.6;">
            Thank you for creating an account with <strong>Vinoff Wholesales Ltd</strong>. Your wholesale access is now active and ready to use.
          </p>

          <div style="margin: 20px 0; padding: 18px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;">
            <h3 style="color: #166534; margin: 0 0 10px; font-size: 15px;">What you can do with your account:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #166534; font-size: 13px; line-height: 1.8;">
              <li><strong>Wholesale Catalog:</strong> Browse commercial toiletries, cleaners, cosmetics, and detergents at verified wholesale prices.</li>
              <li><strong>Flexible Ordering:</strong> Buy in bulk carton bundles or purchase loose units/pieces to assemble custom orders.</li>
              <li><strong>Instant Invoicing:</strong> Automatically generate downloadable PDF invoices for corporate accounting.</li>
              <li><strong>Direct Dispatch Support:</strong> Chat directly with our sales desk and warehouse administration via the portal support chat.</li>
            </ul>
          </div>

          <div style="margin: 28px 0; text-align: center;">
            <a href="${catalogUrl}" style="display: inline-block; background-color: #15803d; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 800; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              Start Shopping Catalog &rarr;
            </a>
          </div>

          <div style="margin: 20px 0; padding: 16px; background-color: #f8fafc; border-radius: 12px; font-size: 13px; color: #475569; line-height: 1.5;">
            <strong style="color: #0f172a;">📍 Physical Warehouse &amp; Showroom:</strong><br/>
            KADUNA PLAZA 1, BLOCK A, SHOP 22,<br/>
            Int’l Centre for Commerce, Trade-Fair Complex,<br/>
            Badagry Express Way, Lagos, Nigeria.<br/>
            Operating Hours: Monday – Saturday: 8:00 AM – 5:30 PM
          </div>

          <p style="color: #64748b; font-size: 12px; line-height: 1.5;">
            If you ever need assistance with bulk pricing, container shipments, or custom invoices, reply to this email or chat with us directly on the website.
          </p>
        </div>

        <div style="padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 11px;">
          &copy; ${new Date().getFullYear()} Vinoff Wholesales Ltd. All rights reserved.
        </div>
      </div>
    `;

    const result = await dispatchEmail({
      to: recipient,
      subject,
      html,
    });

    if (result.success) {
      console.log(
        `[Welcome Email Sent via ${result.provider}]: Delivered to ${recipient} [ID: ${result.messageId}]`
      );
      return { success: true, messageId: result.messageId, provider: result.provider };
    } else {
      return result;
    }
  } catch (err) {
    console.error("[Welcome Email Error]:", err.message);
    return { success: false, error: err.message };
  }
};

export default { sendOrderAlertEmail, sendWelcomeEmail, dispatchEmail };
