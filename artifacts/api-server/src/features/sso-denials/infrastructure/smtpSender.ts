import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/shared/logger";
import type {
  SsoDenialNotificationPayload,
  SsoDenialNotificationSender,
} from "./ssoDenialNotifier";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
}

/**
 * Read SMTP config from env. Returns null when the minimum required
 * vars (`SMTP_HOST` and `SMTP_FROM`) are not set so the boot wiring
 * can fall back to the default logger sender without crashing.
 */
export function readSmtpConfigFromEnv(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST ?? "").trim();
  const from = (process.env.SMTP_FROM ?? "").trim();
  if (!host || !from) return null;
  const portRaw = (process.env.SMTP_PORT ?? "587").trim();
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }
  // Default secure=true on 465 (SMTPS), false elsewhere (STARTTLS upgrade).
  const secureRaw = (process.env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure =
    secureRaw === ""
      ? port === 465
      : secureRaw === "1" || secureRaw === "true" || secureRaw === "on";
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS || undefined;
  return { host, port, secure, user, pass, from };
}

/**
 * Build an SMTP-backed sender that emails admins the rendered subject
 * + body. Each call delivers a single message addressed to all
 * resolved recipients (BCC keeps the addresses private from one
 * another). Delivery errors throw — the notifier swallows them so the
 * SSO callback redirect is never blocked.
 */
export function createSmtpSender(
  config: SmtpConfig,
  transporter: Transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user
      ? { user: config.user, pass: config.pass ?? "" }
      : undefined,
  }),
): SsoDenialNotificationSender {
  return async (payload: SsoDenialNotificationPayload) => {
    const bcc = payload.recipients.map((r) =>
      r.displayName ? `"${r.displayName}" <${r.email}>` : r.email,
    );
    const info = await transporter.sendMail({
      from: config.from,
      to: config.from, // visible header — actual addresses are in BCC
      bcc,
      subject: payload.subjectLine,
      text: payload.body,
    });
    logger.info(
      {
        messageId: info.messageId,
        recipientCount: payload.recipients.length,
        gate: payload.input.gate,
      },
      "SSO denial notification email dispatched",
    );
  };
}
