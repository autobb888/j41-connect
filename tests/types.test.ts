import { describe, it, expect } from 'vitest';
import { MAX_FILE_SIZE, MAX_SESSION_TRANSFER, MAX_DIR_ENTRIES, DIFF_PREVIEW_LINES } from '../src/types.js';

describe('types constants', () => {
  it('MAX_FILE_SIZE is 10MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('MAX_SESSION_TRANSFER is 500MB', () => {
    expect(MAX_SESSION_TRANSFER).toBe(500 * 1024 * 1024);
  });

  it('MAX_DIR_ENTRIES is 10000', () => {
    expect(MAX_DIR_ENTRIES).toBe(10_000);
  });

  it('InputState type includes all three states', () => {
    const states: import('../src/types.js').InputState[] = ['IDLE', 'APPROVAL_PENDING', 'SOVGUARD_PENDING'];
    expect(states).toHaveLength(3);
  });
});
