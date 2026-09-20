import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { confirm, readHidden, readText } from '../src/prompt.js';

function createInput(text: string): Readable {
  const input = new Readable({ read() {} });
  setImmediate(() => {
    setImmediate(() => {
      input.push(text);
      input.push(null);
    });
  });
  return input;
}

function createOutput(chunks?: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks?.push(chunk.toString());
      callback();
    }
  });
}

describe('readHidden', () => {
  it('returns the typed line', async () => {
    const input = createInput('supersecret\n');
    const output = createOutput();

    const value = await readHidden('Password: ', { input, output });

    expect(value).toBe('supersecret');
  });

  it('does not echo the typed input', async () => {
    const chunks: string[] = [];
    const input = createInput('supersecret\n');
    const output = createOutput(chunks);

    await readHidden('Password: ', { input, output });

    expect(chunks.join('')).not.toContain('supersecret');
  });

  it('shows the prompt while hiding the typed input', async () => {
    const chunks: string[] = [];
    const input = createInput('supersecret\n');
    const output = createOutput(chunks);

    await readHidden('Password: ', { input, output });

    expect(chunks.join('')).toContain('Password:');
    expect(chunks.join('')).not.toContain('supersecret');
  });
});

describe('readText', () => {
  it('shows the prompt and returns the typed line', async () => {
    const chunks: string[] = [];
    const input = createInput('alice\n');
    const output = createOutput(chunks);

    const value = await readText('Username: ', { input, output });

    expect(value).toBe('alice');
    expect(chunks.join('')).toContain('Username:');
    expect(chunks.join('')).toContain('alice');
  });
});

describe('confirm', () => {
  it('treats an empty answer as no', async () => {
    const input = createInput('\n');
    const output = createOutput();

    await expect(confirm('Continue? ', { input, output })).resolves.toBe(false);
  });

  it('accepts y as yes', async () => {
    const input = createInput('y\n');
    const output = createOutput();

    await expect(confirm('Continue? ', { input, output })).resolves.toBe(true);
  });
});
