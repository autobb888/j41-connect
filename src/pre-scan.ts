/**
 * Pre-scan — SovGuard directory scan before agent connects
 *
 * Walks the project directory, auto-excludes sensitive files,
 * scans remaining files with SovGuard API, and presents the exclusion
 * list to the buyer for confirmation.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { AUTO_EXCLUDE_PATTERNS } from './types.js';
import type { ExclusionEntry } from './types.js';

interface SovGuardConfig {
  apiKey: string;
  apiUrl: string;
}

export async function preScan(projectDir: string, sovguard?: SovGuardConfig): Promise<{
  exclusions: ExclusionEntry[];
  directoryHash: string;
  confirmed: boolean;
}> {
  console.log(chalk.cyan('\nPre-scanning directory...\n'));

  const exclusions: ExclusionEntry[] = [];
  const allFiles: string[] = [];

  // Walk directory (skip auto-excluded dirs)
  walkDir(projectDir, projectDir, allFiles, exclusions);

  // Scan remaining files with SovGuard API
  if (sovguard) {
    for (const filePath of allFiles) {
      try {
        const relPath = relative(projectDir, filePath);
        const stat = statSync(filePath);
        if (stat.size > 10 * 1024 * 1024) continue; // skip >10MB files

        const content = readFileSync(filePath);
        const result = await scanWithSovGuard(sovguard, relPath, content);

        if (result && !result.safe) {
          exclusions.push({ path: relPath, reason: `SovGuard flagged (score: ${result.score.toFixed(2)})` });
        }
      } catch (err) {
        if (err instanceof SovGuardAuthError) {
          console.warn(chalk.yellow('  SovGuard: invalid API key — skipping scan'));
          break;
        }
        // Can't read/scan file — skip
      }
    }
  }

  // Generate directory hash (file listing + sizes)
  const hashInput = allFiles.map((f) => {
    const rel = relative(projectDir, f);
    const size = statSync(f).size;
    return `${rel}:${size}`;
  }).sort().join('\n');
  const directoryHash = createHash('sha256').update(hashInput).digest('hex');

  // Present to buyer
  if (exclusions.length > 0) {
    console.log(chalk.yellow(`Excluded (${exclusions.length} items):`));
    for (const ex of exclusions) {
      console.log(`  ${ex.path.padEnd(40)} — ${chalk.gray(ex.reason)}`);
    }
  } else {
    console.log(chalk.green('No files excluded.'));
  }

  console.log('');
  // Note: [E]dit exclusions option deferred to v2 — v1 uses Y/A only
  const confirmed = await promptConfirm('Proceed? [Y/Enter] yes / [A] abort');

  return { exclusions, directoryHash, confirmed };
}

function walkDir(
  rootDir: string,
  currentDir: string,
  files: string[],
  exclusions: ExclusionEntry[],
): void {
  let entries;
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return; // Can't read directory — skip
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath);

    // Check auto-exclude patterns
    if (shouldExclude(relPath, entry.isDirectory())) {
      const reason = getExcludeReason(relPath, entry.isDirectory());
      exclusions.push({ path: relPath + (entry.isDirectory() ? '/' : ''), reason });
      continue;
    }

    if (entry.isDirectory()) {
      walkDir(rootDir, fullPath, files, exclusions);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function shouldExclude(relPath: string, isDir: boolean): boolean {
  const name = relPath.split('/').pop() || '';

  for (const pattern of AUTO_EXCLUDE_PATTERNS) {
    // Directory patterns (ending with /)
    if (pattern.endsWith('/') && isDir && name === pattern.slice(0, -1)) return true;
    // Glob patterns (*.ext)
    if (pattern.startsWith('*.') && name.endsWith(pattern.slice(1))) return true;
    // Exact match
    if (name === pattern) return true;
    // Wildcard match (e.g., .env.*)
    if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) return true;
  }

  return false;
}

function getExcludeReason(relPath: string, isDir: boolean): string {
  const name = relPath.split('/').pop() || '';
  if (name.startsWith('.env')) return 'environment variables';
  if (name === '.ssh' || name === '.gnupg') return 'cryptographic keys';
  if (name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.p12')) return 'certificates/keys';
  if (name === 'credentials.json' || name.startsWith('secrets')) return 'credentials';
  if (name === 'node_modules') return 'too large';
  if (name === '.git') return 'version control';
  if (name === '.DS_Store' || name === 'Thumbs.db') return 'OS metadata';
  return 'auto-excluded';
}

async function promptConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes' || a === '');
    });
  });
}

export function isExcluded(relPath: string, exclusions: ExclusionEntry[]): boolean {
  return exclusions.some((ex) => {
    const exPath = ex.path.replace(/\/$/, '');
    return relPath === exPath || relPath.startsWith(exPath + '/');
  });
}

class SovGuardAuthError extends Error {
  constructor() { super('SovGuard: invalid API key'); }
}

async function scanWithSovGuard(
  config: SovGuardConfig,
  filePath: string,
  content: Buffer,
): Promise<{ safe: boolean; score: number } | null> {
  const response = await fetch(`${config.apiUrl}/v1/scan`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_path: filePath,
      content: content.toString('base64'),
      encoding: 'base64',
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new SovGuardAuthError();
    }
    return null;
  }

  const data = await response.json() as { safe: boolean; score: number };
  return data;
}
