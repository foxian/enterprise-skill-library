import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import type { PlatformSettingsRepository } from '../db/database.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  isConfigured(): boolean;
  send(message: MailMessage): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

export function readSmtpSettings(repository: PlatformSettingsRepository): SmtpSettings | null {
  const host = repository.getSetting('smtp_host')?.trim() ?? '';
  const port = Number(repository.getSetting('smtp_port') ?? '0');
  const username = repository.getSetting('smtp_username')?.trim() ?? '';
  const password = repository.getSetting('smtp_password') ?? '';
  const from = repository.getSetting('smtp_from')?.trim() ?? '';
  if (!host || !Number.isInteger(port) || port <= 0 || !from || !username || !password) {
    return null;
  }
  return { host, port, username, password, from };
}

export function hasSmtpSettings(repository: PlatformSettingsRepository): boolean {
  return readSmtpSettings(repository) !== null;
}

export class SmtpMailer implements Mailer {
  constructor(private readonly settingsRepository: PlatformSettingsRepository) {}

  isConfigured(): boolean {
    return hasSmtpSettings(this.settingsRepository);
  }

  async send(message: MailMessage): Promise<void> {
    const settings = readSmtpSettings(this.settingsRepository);
    if (!settings) {
      throw new Error('Outbound email SMTP is not configured');
    }
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.username, pass: settings.password }
    });
    await transporter.sendMail({
      from: settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text
    });
  }
}

export function createActionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashActionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function encryptSecret(secret: string, key: string): string {
  const derivedKey = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(ciphertext: string, key: string): string {
  const [ivText, tagText, encryptedText] = ciphertext.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Invalid encrypted secret');
  const derivedKey = crypto.createHash('sha256').update(key).digest();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    derivedKey,
    Buffer.from(ivText, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function resolveRequestOrigin(request: {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
}): string {
  const forwardedProto = firstHeader(request.headers['x-forwarded-proto']) ?? request.protocol ?? 'http';
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']) ?? firstHeader(request.headers.host);
  if (!forwardedHost) throw new Error('Request host is required to build an email link');
  return `${forwardedProto.split(',')[0].trim()}://${forwardedHost.split(',')[0].trim()}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const EMAIL_ACTION_TTL_MS = 30 * 60 * 1000;

