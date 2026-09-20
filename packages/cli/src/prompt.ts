import { confirm as confirmPrompt, input, password } from '@inquirer/prompts';

export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export function readHidden(prompt: string, streams: PromptStreams = {}): Promise<string> {
  return password({ message: prompt, mask: false, toggleMask: false }, streams);
}

export function readText(prompt: string, streams: PromptStreams = {}): Promise<string> {
  return input({ message: prompt }, streams);
}

export function confirm(question: string, streams: PromptStreams = {}): Promise<boolean> {
  return confirmPrompt({ message: question, default: false }, streams);
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function readStdinText(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      data += chunk;
    });
    input.on('end', () => resolve(data));
    input.on('error', reject);
  });
}
