import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import type { SeedPrompt } from './seed-platform-admin';

export interface TerminalPrompt extends SeedPrompt {
  close(): void;
}

// Interactive prompt on the current terminal. Hidden answers are not echoed:
// readline writes to a stream that drops everything while `muted` is true.
// Without a TTY the answer could not be hidden, so it refuses to start.
export function createTerminalPrompt(): TerminalPrompt {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('This command needs an interactive terminal (TTY).');
  }

  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });

  const question = (text: string): Promise<string> =>
    new Promise((resolve) => rl.question(text, resolve));

  return {
    ask: question,
    async askHidden(text) {
      process.stdout.write(text);
      muted = true;
      try {
        return await question('');
      } finally {
        muted = false;
        process.stdout.write('\n');
      }
    },
    close: () => rl.close(),
  };
}
