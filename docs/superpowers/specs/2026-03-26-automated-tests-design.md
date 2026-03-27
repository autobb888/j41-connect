# Automated Test Suite

**Date**: 2026-03-26
**Status**: Approved
**Scope**: j41-connect — full test coverage with vitest

---

## Problem

Zero automated tests on a security-critical CLI tool. Manual-only verification is insufficient for a production release and blocks CI/CD setup.

## Design

### Test Framework: Vitest

- Native ESM support (matches project's `"type": "module"`)
- Fast, lightweight, built-in mocking (`vi.fn()`, `vi.mock()`)
- Compatible with TypeScript via esbuild transform (no separate ts-jest config)
- `vitest.config.ts` at project root

### Test Structure

```
tests/
├── mcp-server.test.ts     — MCP server path traversal, file ops, JSON-RPC (15 tests)
├── sovguard.test.ts        — Scan API, E2E encryption, failure tracking, reports (12 tests)
├── config.test.ts          — Config file I/O, credential resolution priority chain (10 tests)
├── pre-scan.test.ts        — Exclusion patterns, isExcluded(), directory walk (8 tests)
├── supervisor.test.ts      — State machine, abort, fallback handler, Y/N/R input (10 tests)
├── feed.test.ts            — Log formatting, SovGuard methods, stats tracking (6 tests)
├── cli.test.ts             — parseArgs() validation, credential deprecation warning (8 tests)
└── types.test.ts           — Constants correctness, InputState completeness (3 tests)
```

~72 tests total.

### Test Approaches by Module

**mcp-server.ts** — The MCP server runs inside Docker at runtime but its functions are pure TypeScript. Import and test `resolveSafe()`, `listDirectory()`, `readFile()`, `writeFile()` directly using a temp directory created per test. Verify path traversal rejection, file size limits, binary detection, directory listing caps.

**sovguard.ts** — Mock `global.fetch` with `vi.fn()` to simulate API responses. Test: successful scan, `safe: false` response, 401 auth error, timeout, consecutive failure counting, disabled state. For E2E encryption: create a real AES-256-GCM key, encrypt a payload, verify the encrypted request format (`{ iv, tag, data }` + `X-Encrypted` header), and round-trip decrypt. Test key validation (wrong length, valid 32 bytes). Test report queuing and purge using a temp file.

**config.ts** — Override the config file path (or use a temp directory) per test. Test: write then read round-trip, corrupt file handling (empty, missing `=`, garbage), `clearConfig()`, `resolveCredentials()` priority chain (CLI > env > file > needsPrompt). Use `vi.stubEnv()` for env var tests.

**pre-scan.ts** — Test `shouldExclude()` and `isExcluded()` directly with various file patterns. Create a temp directory tree for `walkDir()` tests. Verify auto-exclusion of `.env`, `.git/`, `*.pem`, `node_modules/`, etc.

**supervisor.ts** — Create the Supervisor with a mock stdin (writable stream piped to readable). Simulate user input by writing to the stream. Test: Y/N approval, Y/N/R SovGuard approval, D/A aliases for failure dialog, abort resolves pending promises, fallback handler receives unrecognized commands, state transitions are sequential.

**feed.ts** — Capture `console.log` output with `vi.spyOn(console, 'log')`. Test: `logOperation()` formatting for reads/writes/blocks, `logSovguardBlock()` output, `logSovguardReadScore()`, `logSovguardDisabledWarning()`, `logSovguardUnscanned()`, `printSummary()` stats.

**cli.ts** — Test `parseArgs()` with various argv combinations. Verify: missing directory exits, missing uid exits, `--write` flag sets permissions, `--supervised` vs `--standard` mode, `_cliSovguardKey` pass-through. Mock `execSync` for Docker check. Verify deprecation warning when `--sovguard-key` is used.

**types.ts** — Verify constant values (`MAX_FILE_SIZE`, `MAX_SESSION_TRANSFER`, etc.) haven't accidentally changed. Verify `InputState` includes all three states.

### What's NOT Tested

- Docker lifecycle (`docker.ts`) — thin wrapper around `dockerode`, tested by the library
- Relay client (`relay-client.ts`) — thin wrapper around `socket.io-client`, tested by the library
- Interactive stdin prompts in `cli.ts` (`readSecret()`) — requires TTY, tested manually
- End-to-end session flow — requires Docker + relay server, tested manually

### Setup

**package.json changes:**
- Add `vitest` as devDependency
- Add `"test": "vitest run"` script
- Add `"test:watch": "vitest"` script

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**tsconfig.json:** No changes needed — vitest uses esbuild for TypeScript, not tsc.

---

## Out of Scope

- Integration tests requiring Docker/relay
- Snapshot testing
- Code coverage thresholds (add in CI setup phase)
- Browser testing
