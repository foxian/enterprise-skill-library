export function notify(message: string): void {
  process.stderr.write(`${message}\n`);
}
