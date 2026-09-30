/**
 * Parses user-agent and IP from request to extract device, browser, and OS
 * @param {import('express').Request} req 
 * @returns {{ device: string, browser: string, os: string, ip: string, userAgent: string }}
 */
export const parseClientInfo = (req) => {
  const ua = req?.headers?.["user-agent"] || "";
  
  // 1. Determine Device
  let device = "Desktop";
  if (/mobile/i.test(ua)) {
    if (/tablet|ipad/i.test(ua)) {
      device = "Tablet";
    } else if (/iphone/i.test(ua)) {
      device = "Mobile (iPhone)";
    } else if (/android/i.test(ua)) {
      device = "Mobile (Android)";
    } else {
      device = "Mobile Device";
    }
  } else if (/tablet|ipad/i.test(ua)) {
    device = "Tablet (iPad)";
  } else if (/macintosh|mac os x/i.test(ua)) {
    device = "Desktop (Mac)";
  } else if (/windows/i.test(ua)) {
    device = "Desktop (Windows)";
  } else if (/linux/i.test(ua)) {
    device = "Desktop (Linux)";
  }

  // 2. Determine Browser
  let browser = "Web Browser";
  if (/edg/i.test(ua)) {
    browser = "Microsoft Edge";
  } else if (/chrome|crios/i.test(ua)) {
    browser = "Google Chrome";
  } else if (/firefox|fxios/i.test(ua)) {
    browser = "Mozilla Firefox";
  } else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) {
    browser = "Apple Safari";
  } else if (/opr\//i.test(ua)) {
    browser = "Opera";
  } else if (/whatsapp/i.test(ua)) {
    browser = "WhatsApp Browser";
  } else if (/instagram/i.test(ua)) {
    browser = "Instagram App";
  } else if (/tiktok/i.test(ua)) {
    browser = "TikTok App";
  }

  // 3. Determine Operating System
  let os = "Unknown OS";
  if (/windows nt 10/i.test(ua)) os = "Windows 10/11";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  // 4. Determine IP Address
  const rawIp =
    req?.headers?.["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
    req?.headers?.["x-real-ip"] ||
    req?.socket?.remoteAddress ||
    req?.ip ||
    "127.0.0.1";
  const ip = rawIp.replace(/^::ffff:/, "");

  return {
    device,
    browser,
    os,
    ip,
    userAgent: ua.slice(0, 300),
  };
};

export default parseClientInfo;
