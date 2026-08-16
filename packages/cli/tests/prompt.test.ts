import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readHidden, readText } from '../src/prompt.js';

describe('readHidden', () => {
  it('returns the typed line', async () => {
    const input = new Readable({ read() {} });
    input.push('supersecret\n');
    input.push(null);

    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });

    const value = await readHidden('Password: ', { input, output });

    expect(value).toBe('supersecret');
  });

  it('does not echo the typed input', async () => {
    const input = new Readable({ read() {} });
    input.push('supersecret\n');
    input.push(null);

    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    await readHidden('Password: ', { input, output });

    expect(chunks.join('')).not.toContain('supersecret');
  });

  it('shows the prompt while hiding the typed input', async () => {
    const input = new Readable({ read() {} });
    input.push('supersecret\n');
    input.push(null);

    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    await readHidden('Password: ', { input, output });

    expect(chunks.join('')).toContain('Password:');
    expect(chunks.join('')).not.toContain('supersecret');
  });
});

describe('readText', () => {
  it('shows the prompt and returns the typed line', async () => {
    const input = new Readable({ read() {} });
    input.push('alice\n');
    input.push(null);

    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });

    const value = await readText('Username: ', { input, output });

    expect(value).toBe('alice');
    expect(chunks.join('')).toContain('Username:');
    expect(chunks.join('')).toContain('alice');
  });
});
