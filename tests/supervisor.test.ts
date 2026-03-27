import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PassThrough } from 'stream';

// Mock process.stdin before importing Supervisor
let mockStdin: PassThrough;

describe('Supervisor', () => {
  let Supervisor: any;
  let origStdin: any;

  beforeEach(async () => {
    mockStdin = new PassThrough();
    // Fake TTY properties
    (mockStdin as any).isTTY = false;
    (mockStdin as any).setRawMode = vi.fn();
    (mockStdin as any).isRaw = false;

    origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

    vi.resetModules();
    const mod = await import('../src/supervisor.js');
    Supervisor = mod.Supervisor;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: origStdin, writable: true });
    mockStdin.destroy();
  });

  function sendInput(text: string) {
    mockStdin.push(text + '\n');
  }

  it('resolves write approval with true on Y input', async () => {
    const sup = new Supervisor();
    const promise = sup.promptWriteApproval('test.txt', 'content', '/tmp');

    // Small delay to let readline register
    await new Promise((r) => setTimeout(r, 10));
    sendInput('y');

    const result = await promise;
    expect(result).toBe(true);
    sup.close();
  });

  it('resolves write approval with false on N input', async () => {
    const sup = new Supervisor();
    const promise = sup.promptWriteApproval('test.txt', 'content', '/tmp');

    await new Promise((r) => setTimeout(r, 10));
    sendInput('n');

    const result = await promise;
    expect(result).toBe(false);
    sup.close();
  });

  it('resolves SovGuard approval with approve on Y', async () => {
    const sup = new Supervisor();
    const promise = sup.promptSovguardApproval('test.txt', 0.85, 'suspicious');

    await new Promise((r) => setTimeout(r, 10));
    sendInput('y');

    const result = await promise;
    expect(result).toBe('approve');
    sup.close();
  });

  it('resolves SovGuard approval with reject on N', async () => {
    const sup = new Supervisor();
    const promise = sup.promptSovguardApproval('test.txt', 0.85);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('n');

    const result = await promise;
    expect(result).toBe('reject');
    sup.close();
  });

  it('resolves SovGuard approval with report on R', async () => {
    const sup = new Supervisor();
    const promise = sup.promptSovguardApproval('test.txt', 0.85);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('r');

    const result = await promise;
    expect(result).toBe('report');
    sup.close();
  });

  it('accepts D as alias for report in SovGuard state', async () => {
    const sup = new Supervisor();
    const promise = sup.promptSovguardFailure(3);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('d');

    const result = await promise;
    expect(result).toBe('report'); // D maps to 'report' (disable)
    sup.close();
  });

  it('accepts A as alias for reject in SovGuard state', async () => {
    const sup = new Supervisor();
    const promise = sup.promptSovguardFailure(3);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('a');

    const result = await promise;
    expect(result).toBe('reject'); // A maps to 'reject' (abort)
    sup.close();
  });

  it('abort resolves pending SovGuard promise as reject', async () => {
    const sup = new Supervisor();
    const abortHandler = vi.fn();
    sup.onCommand(abortHandler);

    const promise = sup.promptSovguardApproval('test.txt', 0.9);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('abort');

    const result = await promise;
    expect(result).toBe('reject');
    // abort should NOT call commandHandler when a pending promise was resolved
    expect(abortHandler).not.toHaveBeenCalled();
    sup.close();
  });

  it('routes unrecognized commands to fallback handler in IDLE', async () => {
    const sup = new Supervisor();
    const fallback = vi.fn();
    sup.onFallbackCommand(fallback);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('report');

    await new Promise((r) => setTimeout(r, 10));
    expect(fallback).toHaveBeenCalledWith('report');
    sup.close();
  });

  it('routes known commands to command handler in IDLE', async () => {
    const sup = new Supervisor();
    const cmdHandler = vi.fn();
    sup.onCommand(cmdHandler);

    await new Promise((r) => setTimeout(r, 10));
    sendInput('pause');

    await new Promise((r) => setTimeout(r, 10));
    expect(cmdHandler).toHaveBeenCalledWith('pause');
    sup.close();
  });
});
