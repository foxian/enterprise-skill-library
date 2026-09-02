import { describe, expect, it } from 'vitest';
import { decryptApplicationSecret, encryptApplicationSecret } from '../src/services/application-secret.js';

describe('application secret encryption', () => {
  it('round-trips an application password without storing it in plaintext', () => {
    const key = 'a'.repeat(64);
    const encrypted = encryptApplicationSecret('initial-password', key);

    expect(encrypted).not.toContain('initial-password');
    expect(decryptApplicationSecret(encrypted, key)).toBe('initial-password');
  });

  it('rejects an invalid encryption key', () => {
    expect(() => encryptApplicationSecret('secret', 'short')).toThrow(
      'ESL_APPLICATION_ENCRYPTION_KEY must be 32 bytes'
    );
  });
});
