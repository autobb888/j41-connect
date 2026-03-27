import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to test with a temp config directory.
// config.ts reads process.env.HOME at module load time to set CONFIG_DIR/CONFIG_FILE.
// We override HOME before each test and use vi.resetModules() to force a fresh import.

describe('config', () => {
  let origHome: string | undefined;
  let origSovguardKey: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    origHome = process.env.HOME;
    origSovguardKey = process.env.SOVGUARD_API_KEY;
    tempHome = join(tmpdir(), `j41-config-test-${Date.now()}`);
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
    delete process.env.SOVGUARD_API_KEY;
    // Force re-import so CONFIG_DIR/CONFIG_FILE pick up the new HOME
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origSovguardKey !== undefined) {
      process.env.SOVGUARD_API_KEY = origSovguardKey;
    } else {
      delete process.env.SOVGUARD_API_KEY;
    }
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true });
    vi.restoreAllMocks();
  });

  describe('writeConfig + readConfig round-trip', () => {
    it('writes and reads config correctly', async () => {
      const mod = await import('../src/config.js');
      mod.writeConfig({
        sovguard_api_key: 'sg_test_123',
        sovguard_encryption_key: 'abc123base64key',
        sovguard_api_url: 'https://custom.url',
      });

      const config = mod.readConfig();
      expect(config.sovguard_api_key).toBe('sg_test_123');
      expect(config.sovguard_encryption_key).toBe('abc123base64key');
      expect(config.sovguard_api_url).toBe('https://custom.url');
    });

    it('ignores empty values', async () => {
      const mod = await import('../src/config.js');
      const configDir = join(tempHome, '.j41');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config'),
        'sovguard_api_key=\nsovguard_encryption_key=real_key\n',
      );

      const config = mod.readConfig();
      expect(config.sovguard_api_key).toBeUndefined();
      expect(config.sovguard_encryption_key).toBe('real_key');
    });

    it('handles comments and blank lines', async () => {
      const mod = await import('../src/config.js');
      const configDir = join(tempHome, '.j41');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config'),
        '# comment\n\nsovguard_api_key=key123\n',
      );

      const config = mod.readConfig();
      expect(config.sovguard_api_key).toBe('key123');
    });
  });

  describe('corrupt config handling', () => {
    it('returns empty object for corrupt file', async () => {
      const mod = await import('../src/config.js');
      const configDir = join(tempHome, '.j41');
      mkdirSync(configDir, { recursive: true });
      // Binary garbage — readFileSync('utf-8') will not throw, but the content
      // won't match any valid key=value lines so the result is an empty object.
      writeFileSync(join(configDir, 'config'), Buffer.from([0x00, 0x01, 0x02]));

      const config = mod.readConfig();
      expect(typeof config).toBe('object');
      expect(config.sovguard_api_key).toBeUndefined();
    });

    it('returns empty object for missing file', async () => {
      const mod = await import('../src/config.js');
      const config = mod.readConfig();
      expect(config).toEqual({});
    });
  });

  describe('clearConfig', () => {
    it('deletes config file and returns true', async () => {
      const mod = await import('../src/config.js');
      mod.writeConfig({ sovguard_api_key: 'key' });
      expect(mod.clearConfig()).toBe(true);

      const config = mod.readConfig();
      expect(config.sovguard_api_key).toBeUndefined();
    });

    it('returns false when no file exists', async () => {
      const mod = await import('../src/config.js');
      expect(mod.clearConfig()).toBe(false);
    });
  });

  describe('resolveCredentials', () => {
    it('CLI flags take highest priority', async () => {
      const mod = await import('../src/config.js');
      const result = mod.resolveCredentials({
        sovguardKey: 'cli_key',
        sovguardUrl: 'https://cli.url',
      });
      expect(result.config?.apiKey).toBe('cli_key');
      expect(result.config?.apiUrl).toBe('https://cli.url');
      expect(result.cliKeyUsed).toBe(true);
      expect(result.needsPrompt).toBe(false);
    });

    it('env vars take second priority', async () => {
      process.env.SOVGUARD_API_KEY = 'env_key';
      const mod = await import('../src/config.js');
      const result = mod.resolveCredentials({});
      expect(result.config?.apiKey).toBe('env_key');
      expect(result.source).toBe('env var');
      expect(result.cliKeyUsed).toBe(false);
      expect(result.needsPrompt).toBe(false);
    });

    it('config file used when no CLI flag or env var', async () => {
      const mod = await import('../src/config.js');
      mod.writeConfig({ sovguard_api_key: 'file_key' });
      const result = mod.resolveCredentials({});
      expect(result.config?.apiKey).toBe('file_key');
      expect(result.source).toBe('~/.j41/config');
      expect(result.cliKeyUsed).toBe(false);
      expect(result.needsPrompt).toBe(false);
    });

    it('returns needsPrompt when nothing found', async () => {
      const mod = await import('../src/config.js');
      const result = mod.resolveCredentials({});
      expect(result.config).toBeUndefined();
      expect(result.needsPrompt).toBe(true);
    });
  });
});
