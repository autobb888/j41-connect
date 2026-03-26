/**
 * Supervised mode — diff preview + Y/N approval for writes
 *
 * Manages stdin state machine to handle both interactive commands
 * (pause/resume/abort/accept) and write approval prompts (Y/N).
 */

import { createInterface, Interface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { structuredPatch } from 'diff';
import chalk from 'chalk';
import { DIFF_PREVIEW_LINES } from './types.js';
import type { InputState } from './types.js';

export class Supervisor {
  private state: InputState = 'IDLE';
  private pendingResolve: ((approved: boolean) => void) | null = null;
  private commandHandler: ((cmd: string) => void) | null = null;
  private rl: Interface;

  constructor() {
    // Ensure stdin is in a clean state for readline
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.on('line', (line) => {
      const input = line.trim().toLowerCase();

      // abort and Ctrl+C work in ANY state
      if (input === 'abort') {
        this.commandHandler?.('abort');
        return;
      }

      if (this.state === 'APPROVAL_PENDING' && this.pendingResolve) {
        if (input === 'y' || input === 'yes') {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          this.state = 'IDLE';
          resolve(true);
        } else if (input === 'n' || input === 'no') {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          this.state = 'IDLE';
          resolve(false);
        }
        // Ignore other input during approval
        return;
      }

      // IDLE state — handle commands
      if (this.state === 'IDLE' && this.commandHandler) {
        if (['pause', 'resume', 'accept'].includes(input)) {
          this.commandHandler(input);
        }
      }
    });
  }

  onCommand(handler: (cmd: string) => void): void {
    this.commandHandler = handler;
  }

  async promptWriteApproval(
    path: string,
    proposedContent: string,
    projectDir: string,
  ): Promise<boolean> {
    // Prevent path traversal on host filesystem
    const relPath = path.replace(/^\/+/, '');
    if (relPath.includes('..') || path.startsWith('/')) {
      console.log(`\n  Blocked: path traversal attempt: ${path}`);
      return false;
    }

    const fullPath = join(projectDir, relPath);
    const resolved = resolve(fullPath);
    if (!resolved.startsWith(resolve(projectDir) + '/')) {
      console.log(`\n  Blocked: path escapes project directory: ${path}`);
      return false;
    }

    const currentContent = existsSync(fullPath)
      ? readFileSync(fullPath, 'utf-8')
      : '';

    // Generate diff
    const patch = structuredPatch(path, path, currentContent, proposedContent);
    const diffLines = patch.hunks.flatMap((hunk: { lines: string[] }) =>
      hunk.lines.map((line: string) => {
        if (line.startsWith('+')) return chalk.green(line);
        if (line.startsWith('-')) return chalk.red(line);
        return chalk.gray(line);
      })
    );

    const sizeKB = (Buffer.byteLength(proposedContent, 'utf-8') / 1024).toFixed(1);
    console.log('');
    console.log(chalk.yellow(`WRITE ${path} (${sizeKB}KB)`));

    // Show first N lines of diff
    const preview = diffLines.slice(0, DIFF_PREVIEW_LINES);
    for (const line of preview) {
      console.log(`  ${line}`);
    }
    if (diffLines.length > DIFF_PREVIEW_LINES) {
      console.log(chalk.gray(`  ... ${diffLines.length - DIFF_PREVIEW_LINES} more lines`));
    }

    console.log(chalk.cyan('[Y]es / [N]o?'));

    // Set state and wait for approval
    this.state = 'APPROVAL_PENDING';
    return new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(): void {
    this.rl.close();
  }
}
