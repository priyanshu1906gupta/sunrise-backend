import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../config/env";

const SMTP_TIMEOUT_MS = 8_000;

type SmtpHop = {
  host: string;
  port: number;
  secure?: boolean;
  requireTLS?: boolean;
  auth?: boolean;
  timeoutMs?: number;
};

function isConnectFailure(error: unknown): boolean {
  const code = String((error as { code?: string }).code || "");
  return ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ETLS", "EPROTO", "EDNS", "ENOTFOUND"].includes(code);
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, "");
}

/** Titan: mailbox password, or Application Password when 2FA is on. */
function smtpPassword(): string {
  return (env.SMTP_APP_PASS || env.SMTP_PASS).trim();
}

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return !v || /^(YOUR_|CHANGE_ME)/i.test(v) || /YOUR_SMTP|YOUR_MAILBOX|YOUR_DOMAIN/i.test(v);
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    env.SMTP_HOST?.trim() &&
      !isPlaceholder(env.SMTP_HOST) &&
      env.SMTP_USER?.trim() &&
      !isPlaceholder(env.SMTP_USER) &&
      smtpPassword() &&
      !isPlaceholder(smtpPassword()),
  );
}

/**
 * Local PCs can use 465/587. GoDaddy Node/AiroApp often blocks those ports.
 * Workspace also accepts 80/3535; hosting relay is port 25 without login.
 */
function smtpHops(): SmtpHop[] {
  const host = env.SMTP_HOST.trim() || "smtpout.secureserver.net";
  const hops: SmtpHop[] = [];
  const add = (hop: SmtpHop) => {
    if (!hops.some((existing) => existing.host === hop.host && existing.port === hop.port)) hops.push(hop);
  };
  const preferred = env.SMTP_PORT || 465;
  add({ host, port: preferred, secure: preferred === 465, requireTLS: preferred === 587 });
  add({ host, port: 465, secure: true });
  add({ host, port: 587, requireTLS: true });
  add({ host, port: 80, requireTLS: true });
  add({ host, port: 3535, requireTLS: true });
  add({ host, port: 25 });
  add({ host: "relay-hosting.secureserver.net", port: 25, auth: false });
  if (env.NODE_ENV === "production") {
    add({ host: "localhost", port: 25, auth: false, timeoutMs: 4_000 });
  }
  return hops;
}

function smtpTransportOptions(hop: SmtpHop): SMTPTransport.Options {
  const timeout = hop.timeoutMs ?? SMTP_TIMEOUT_MS;
  const options: SMTPTransport.Options & { family?: number } = {
    host: hop.host,
    port: hop.port,
    family: 4,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  };
  if (hop.host !== "localhost") {
    options.tls = { minVersion: "TLSv1.2", servername: hop.host };
  }
  if (hop.secure) options.secure = true;
  if (hop.requireTLS) options.requireTLS = true;
  if (hop.auth === false) options.ignoreTLS = true;
  if (hop.auth !== false) {
    options.auth = {
      user: env.SMTP_USER.trim(),
      pass: smtpPassword(),
    };
  }
  return options;
}

function mailFrom(): string {
  const user = env.SMTP_USER.trim();
  const from = stripQuotes(env.SMTP_FROM);
  if (!from || from.includes("sunrise.local")) return user;
  if (from.toLowerCase().includes(user.toLowerCase())) return from;
  return user;
}

function describeMailError(error: unknown): string {
  const err = error as { code?: string; responseCode?: number };
  if (err.responseCode === 550 || err.responseCode === 553) {
    return "SMTP relay denied (550/553). Use smtpout.secureserver.net with SMTP authentication on. Sending without login, or via the wrong host, is blocked as spam prevention.";
  }
  if (err.code === "EAUTH" || err.responseCode === 535) {
    return "SMTP 535: login rejected. This mailbox is GoDaddy Workspace — use smtpout.secureserver.net (not smtp.titan.email). If 2FA is on, use an app password.";
  }
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKET" || err.code === "ECONNECTION" || err.code === "ECONNREFUSED") {
    return "GoDaddy Node hosting blocked outbound SMTP (ports 465/587). That is why local works and live does not. The app also tried ports 80, 3535, 25 and relay-hosting.secureserver.net. Ask GoDaddy to allow outbound SMTP from this app, or use cPanel localhost:25 relay.";
  }
  if (err.code === "EDNS" || err.code === "ENOTFOUND") {
    return `SMTP host could not be resolved (${err.code}). SMTP_HOST must be smtpout.secureserver.net — not YOUR_SMTP_HOST. Set this on the Publish secrets tab and restart.`;
  }
  const detail = error instanceof Error ? error.message : "";
  return detail ? `Could not send email: ${detail}` : "Could not send email";
}

export async function sendMail(
  to: string,
  subject: string,
  html: string,
  options?: { required?: boolean; replyTo?: string; text?: string },
): Promise<void> {
  const mustDeliver = options?.required === true || env.NODE_ENV === "production";
  if (!isSmtpConfigured()) {
    console.warn("[mail] Not sent: set SMTP_HOST, SMTP_USER, and SMTP_PASS (or SMTP_APP_PASS).");
    console.log(`[mail:dev] to=${to} subject=${subject}\n${html}`);
    if (mustDeliver) {
      throw new Error(
        "SMTP is not configured on this server. In Secrets → Publish set SMTP_HOST=smtpout.secureserver.net, SMTP_PORT=465, SMTP_USER=admin@online-business-erp.com, and SMTP_PASS to the mailbox password. Remove YOUR_SMTP_HOST / YOUR_SMTP_USER placeholders.",
      );
    }
    return;
  }

  const hops = smtpHops();
  let lastError: unknown;

  for (const hop of hops) {
    const transporter = nodemailer.createTransport(smtpTransportOptions(hop));
    try {
      const info = await transporter.sendMail({
        from: mailFrom(),
        to,
        replyTo: options?.replyTo,
        subject,
        text: options?.text,
        html,
        envelope: {
          from: env.SMTP_USER.trim(),
          to,
        },
      });
      if (info.rejected?.length) {
        throw new Error(`Mail server rejected recipient: ${info.rejected.join(", ")}`);
      }
      console.log("[mail] accepted", {
        to,
        host: hop.host,
        port: hop.port,
        messageId: info.messageId,
        accepted: info.accepted,
        response: info.response,
      });
      return;
    } catch (error) {
      lastError = error;
      const err = error as { code?: string; command?: string; response?: string; responseCode?: number };
      console.warn("[mail] hop failed", {
        host: hop.host,
        port: hop.port,
        auth: hop.auth !== false,
        code: err.code,
        command: err.command,
        responseCode: err.responseCode,
        response: err.response,
      });
      if (!isConnectFailure(error)) {
        console.error("[mail]", describeMailError(error), {
          user: env.SMTP_USER,
          passLength: smtpPassword().length,
          usingAppPass: Boolean(env.SMTP_APP_PASS),
        });
        throw new Error(describeMailError(error));
      }
    }
  }

  console.error("[mail]", describeMailError(lastError), {
    user: env.SMTP_USER,
    passLength: smtpPassword().length,
    hopsTried: hops.map((hop) => `${hop.host}:${hop.port}`),
  });
  throw new Error(describeMailError(lastError));
}

export function otpEmailTemplate(code: string): { subject: string; text: string; html: string } {
  const text = `Your Sunrise Coaching Khargone password reset code is ${code}. It expires in 5 minutes. If you did not request this, ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:12px">
      <h2 style="margin-top:0">Sunrise Coaching Khargone</h2>
      <p>Your password reset OTP is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center">${code}</p>
      <p>This code expires in 5 minutes. If you did not request a reset, ignore this email.</p>
      <p style="color:#888;font-size:12px">Coaching institute for PAT exams.</p>
    </div>
  `;
  return { subject: "Sunrise Coaching Khargone password reset OTP", text, html };
}

export function helpQueryEmailTemplate(input: {
  title: string;
  description: string;
  senderName: string;
  senderEmail: string;
  companyName: string;
}): string {
  const safe = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:12px">
      <h2 style="margin-top:0">Sunrise Coaching Khargone support query</h2>
      <p><strong>Title:</strong> ${safe(input.title)}</p>
      <p><strong>From:</strong> ${safe(input.senderName)} &lt;${safe(input.senderEmail)}&gt;</p>
      <p><strong>Company:</strong> ${safe(input.companyName)}</p>
      <p style="white-space:pre-wrap">${safe(input.description)}</p>
    </div>
  `;
}
