import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function resolveKey(value: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'utf8');
  if (key.length !== 32) {
    throw new Error('ESL_APPLICATION_ENCRYPTION_KEY must be 32 bytes');
  }
  return key;
}

export function encryptApplicationSecret(secret: string, keyValue: string): string {
  const key = resolveKey(keyValue);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptApplicationSecret(encrypted: string, keyValue: string): string {
  const key = resolveKey(keyValue);
  const [version, ivValue, tagValue, ciphertextValue] = encrypted.split(':');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Invalid application secret');
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new Error('Invalid application secret');
  }
}
