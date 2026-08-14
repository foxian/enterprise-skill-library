import readline from 'node:readline';

export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface MutableReadline extends readline.Interface {
  _writeToOutput: (text: string) => void;
}

export function readHidden(prompt: string, streams: PromptStreams = {}): Promise<string> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output, terminal: true }) as MutableReadline;
    const originalWriteToOutput = rl._writeToOutput.bind(rl);

    rl._writeToOutput = () => {
      // Suppress echoing of the typed input. The prompt itself is written
      // directly to output by readline, so it remains visible.
    };

    rl.question(prompt, (answer) => {
      rl._writeToOutput = originalWriteToOutput;
      rl.close();
      output.write('\n');
      resolve(answer);
    });
    rl.on('error', reject);
  });
}

export function confirm(question: string, streams: PromptStreams = {}): Promise<boolean> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stdout;

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
    rl.on('error', reject);
  });
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
