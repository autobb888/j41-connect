/**
 * Terminal live feed — operation logging
 *
 * Default: minimal (timestamp + operation + path + result)
 * Verbose: adds file size and details
 */

import chalk from 'chalk';
import type { OperationMetadata, SessionStats } from './types.js';

export class Feed {
  private verbose: boolean;
  private stats: SessionStats;

  constructor(verbose: boolean) {
    this.verbose = verbose;
    this.stats = { reads: 0, writes: 0, blocked: 0, totalBytes: 0, startedAt: Date.now() };
  }

  logOperation(meta: OperationMetadata, approved?: boolean): void {
    const time = this.timestamp();
    const op = this.formatOp(meta.operation);
    const path = meta.path;
    const size = meta.sizeBytes ? this.formatSize(meta.sizeBytes) : '';

    if (meta.blocked) {
      this.stats.blocked++;
      const reason = meta.blockReason || 'blocked';
      console.log(`${time}  ${chalk.red('BLOCKED')} ${path}  ${chalk.red('✗')} ${reason}`);
      return;
    }

    if (['read', 'read_file', 'list_dir', 'list_directory', 'search', 'search_files', 'get_file_info', 'directory_tree'].includes(meta.operation)) {
      this.stats.reads++;
    } else if (meta.operation === 'write' || meta.operation === 'write_file') {
      this.stats.writes++;
    }

    if (meta.sizeBytes) {
      this.stats.totalBytes += meta.sizeBytes;
    }

    const status = meta.operation === 'write'
      ? (approved ? chalk.green('✓ approved') : chalk.red('✗ rejected'))
      : chalk.green('✓');

    if (this.verbose) {
      console.log(`${time}  ${op} ${path.padEnd(40)} ${size.padStart(8)}  ${status}`);
    } else {
      console.log(`${time}  ${op} ${path.padEnd(40)} ${status}`);
    }
  }

  logStatus(message: string): void {
    console.log(`${this.timestamp()}  ${chalk.cyan('INFO')}   ${message}`);
  }

  logError(message: string): void {
    console.log(`${this.timestamp()}  ${chalk.red('ERROR')}  ${message}`);
  }

  logChatReady(): void {
    console.log(chalk.dim('Chat enabled. Type to message agent. Commands: /accept /abort /pause /resume'));
  }

  printSummary(): void {
    const duration = Math.floor((Date.now() - this.stats.startedAt) / 1000);
    const minutes = Math.floor(duration / 60);

    console.log('');
    console.log(chalk.green('Session complete.'));
    console.log(`Files read: ${this.stats.reads} | Written: ${this.stats.writes} | Blocked: ${this.stats.blocked}`);
    console.log(`Duration: ${minutes} minutes`);
    console.log(`Total transfer: ${this.formatSize(this.stats.totalBytes)}`);
  }

  getStats(): SessionStats {
    return { ...this.stats };
  }

  private timestamp(): string {
    return chalk.gray(new Date().toLocaleTimeString('en-US', { hour12: false }));
  }

  private formatOp(op: string): string {
    switch (op) {
      case 'read':
      case 'read_file': return chalk.blue('READ  ');
      case 'write':
      case 'write_file': return chalk.yellow('WRITE ');
      case 'list_dir':
      case 'list_directory':
      case 'directory_tree': return chalk.gray('LIST  ');
      case 'search':
      case 'search_files': return chalk.magenta('SEARCH');
      case 'get_file_info': return chalk.gray('INFO  ');
      default: return op.padEnd(6);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
