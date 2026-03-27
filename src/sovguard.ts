/**
 * SovGuard API client — scanning, report queuing, failure tracking
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import chalk from 'chalk';

export interface SovGuardConfig {
  apiKey: string;
  apiUrl: string;
}

export interface SovGuardScanResult {
  safe: boolean;
  score: number;
  reason?: string;
  category?: string;
}

export interface SovGuardReport {
  file_path: string;
  content_hash: string;
  score: number;
  mime_type: string;
  workspace_uid: string;
  timestamp: string;
  verdict: 'false_positive';
}

export class SovGuardAuthError extends Error {
  constructor() { super('SovGuard: invalid API key'); }
}

const SCAN_TIMEOUT_MS = 5000;
const SCAN_MAX_BYTES = 100 * 1024; // 100KB
const REPORT_FILE = join(process.env.HOME || '~', '.j41', 'sovguard-reports.jsonl');
const REPORT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class SovGuardClient {
  private config: SovGuardConfig;
  private _consecutiveFailures = 0;
  private _disabled = false;

  constructor(config: SovGuardConfig) {
    this.config = config;
  }

  get consecutiveFailures(): number { return this._consecutiveFailures; }
  isDisabled(): boolean { return this._disabled; }
  disable(): void { this._disabled = true; }

  async scanContent(content: Buffer, mimeType: string): Promise<SovGuardScanResult | null> {
    if (this._disabled) return null;

    if (content.length > SCAN_MAX_BYTES) {
      return null; // Caller handles oversized content
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.config.apiUrl}/v1/scan/file/content`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content.toString('base64'),
          mimeType,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new SovGuardAuthError();
        }
        this._consecutiveFailures++;
        return null;
      }

      this._consecutiveFailures = 0;
      return await response.json() as SovGuardScanResult;
    } catch (err) {
      if (err instanceof SovGuardAuthError) throw err;
      this._consecutiveFailures++;
      return null; // Timeout or network error
    } finally {
      clearTimeout(timer);
    }
  }

  contentHash(content: Buffer): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }

  queueReport(report: SovGuardReport): void {
    const dir = dirname(REPORT_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(report) + '\n';
    writeFileSync(REPORT_FILE, line, { flag: 'a', mode: 0o600 });

    try {
      chmodSync(REPORT_FILE, 0o600);
    } catch {
      // Best effort
    }
  }

  purgeOldReports(): void {
    if (!existsSync(REPORT_FILE)) return;

    try {
      const raw = readFileSync(REPORT_FILE, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const cutoff = Date.now() - REPORT_MAX_AGE_MS;

      const kept = lines.filter((line) => {
        try {
          const report = JSON.parse(line);
          return new Date(report.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });

      writeFileSync(REPORT_FILE, kept.join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
    } catch {
      // File read error — skip purge
    }
  }

  /** Stub — sends queued reports to POST /v1/report when endpoint exists */
  async flushReports(): Promise<void> {
    // TODO: implement when SovGuard builds POST /v1/report
    // For now, just purge old reports
    this.purgeOldReports();
  }
}

export { SCAN_MAX_BYTES };
