/**
 * CLI argument parsing and main orchestration
 */

import { Command } from 'commander';
import { existsSync, statSync, readFileSync } from 'fs';
import { resolve, relative, join } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import chalk from 'chalk';
import type { WorkspaceConfig, McpCall, McpResult, ExclusionEntry, OperationMetadata } from './types.js';
import { MAX_SESSION_TRANSFER } from './types.js';
import { preScan, isExcluded } from './pre-scan.js';
import { DockerManager, getMcpServerPath } from './docker.js';
import { RelayClient } from './relay-client.js';
import { Supervisor } from './supervisor.js';
import { Feed } from './feed.js';

const J41_API_URL = process.env.J41_API_URL || 'https://api.autobb.app';

export function parseArgs(argv: string[]): WorkspaceConfig {
  const program = new Command();

  program
    .name('j41-connect')
    .description('Connect hired AI agents to your local project through Junction41')
    .version('0.1.0')
    .argument('<directory>', 'Project directory to share with the agent')
    .option('--uid <token>', 'Workspace UID from dashboard')
    .option('--resume <token>', 'Reconnect with fresh reconnect token')
    .option('--read', 'Allow agent to read files (always on)', true)
    .option('--write', 'Allow agent to write files')
    .option('--supervised', 'Approve each write action (default)')
    .option('--standard', 'Agent works freely, buyer watches feed')
    .option('--verbose', 'Show file sizes and details in feed')
    .parse(argv);

  const opts = program.opts();
  const dir = program.args[0];

  // Validate directory
  if (!dir) {
    console.error(chalk.red('Error: Project directory is required'));
    console.error('Usage: j41-connect ./my-project --uid <token> --read --write');
    process.exit(1);
  }

  const projectDir = resolve(dir);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    console.error(chalk.red(`Error: "${dir}" is not a valid directory`));
    process.exit(1);
  }

  // Require either --uid or --resume
  if (!opts.uid && !opts.resume) {
    console.error(chalk.red('Error: --uid <token> or --resume <token> is required'));
    console.error('Generate a workspace token on the Junction41 dashboard.');
    process.exit(1);
  }

  // Check Docker is available
  if (!isDockerAvailable()) {
    console.error(chalk.red('Docker is required to run j41-connect.\n'));
    console.error('Install Docker:');
    console.error('  macOS:   brew install --cask docker');
    console.error('  Ubuntu:  sudo apt install docker.io');
    console.error('  Windows: https://docs.docker.com/desktop/install/windows/');
    console.error('  Other:   https://docs.docker.com/get-docker/');
    process.exit(1);
  }

  // Determine mode
  const mode = opts.standard ? 'standard' : 'supervised';

  return {
    projectDir,
    uid: opts.uid || '',
    resumeToken: opts.resume,
    permissions: { read: true, write: !!opts.write },
    mode,
    verbose: !!opts.verbose,
    apiUrl: J41_API_URL,
  };
}

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkGitStatus(projectDir: string): void {
  try {
    // Check if it's a git repo
    execSync('git rev-parse --git-dir', { cwd: projectDir, stdio: 'ignore' });

    // Check for uncommitted changes
    const status = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf-8' });
    if (status.trim()) {
      console.warn(chalk.yellow('Warning: Uncommitted changes detected. Recommend committing before starting.'));
      // Non-blocking warning — user can proceed
    }
  } catch {
    console.warn(chalk.yellow('Warning: Not a git repo. Changes made by the agent cannot be easily reverted.'));
    console.warn(chalk.yellow('Consider: git init && git add -A && git commit -m "pre-workspace snapshot"'));
  }
}

export async function run(config: WorkspaceConfig): Promise<void> {
  const feed = new Feed(config.verbose);
  const docker = new DockerManager();
  const relay = new RelayClient();
  const supervisor = config.mode === 'supervised' ? new Supervisor() : null;
  let exclusions: ExclusionEntry[] = [];
  let sessionTransferBytes = 0;

  // ── Cleanup function (used by signals + normal exit) ─────────
  let cleanedUp = false;
  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    feed.printSummary();
    supervisor?.close();
    relay.disconnect();
    await docker.stop();
  }

  // ── Signal handlers ──────────────────────────────────────────
  const handleSignal = async () => {
    feed.logStatus('Shutting down...');
    relay.sendAbort();
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  process.on('SIGHUP', handleSignal);
  process.on('uncaughtException', async (err) => {
    console.error(chalk.red(`Fatal error: ${err.message}`));
    await cleanup();
    process.exit(1);
  });
  process.on('exit', () => {
    // Last-resort safety net — sync cleanup
    if (docker.isRunning()) {
      try { execSync(`docker rm -f $(docker ps -q --filter name=j41-connect-)`, { stdio: 'ignore' }); } catch {}
    }
  });

  try {
    // ── 1. Git check ───────────────────────────────────────────
    checkGitStatus(config.projectDir);

    // ── 2. Pre-scan ────────────────────────────────────────────
    const scanResult = await preScan(config.projectDir);
    if (!scanResult.confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
    exclusions = scanResult.exclusions;

    // ── 3. Start Docker ────────────────────────────────────────
    feed.logStatus('Starting Docker container...');
    const mcpServerPath = getMcpServerPath();
    const { stdin: dockerStdin, stdout: dockerStdout } = await docker.start(config.projectDir, mcpServerPath);
    feed.logStatus('Docker container running');

    // Buffer for reading JSON-RPC responses from MCP server
    let mcpBuffer = '';
    const pendingMcpRequests = new Map<number, (result: any) => void>();
    let mcpRequestId = 0;

    dockerStdout.on('data', (chunk: Buffer) => {
      mcpBuffer += chunk.toString();
      const lines = mcpBuffer.split('\n');
      mcpBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pendingMcpRequests.has(msg.id)) {
            pendingMcpRequests.get(msg.id)!(msg);
            pendingMcpRequests.delete(msg.id);
          }
        } catch { /* ignore non-JSON */ }
      }
    });

    // Helper to call MCP server in Docker
    async function callMcpServer(method: string, params: any): Promise<any> {
      const id = ++mcpRequestId;
      const request = { jsonrpc: '2.0', id, method, params };
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingMcpRequests.delete(id);
          reject(new Error('MCP server timeout'));
        }, 30_000);
        pendingMcpRequests.set(id, (response) => {
          clearTimeout(timeout);
          if (response.error) reject(new Error(response.error.message));
          else resolve(response.result);
        });
        dockerStdin.write(JSON.stringify(request) + '\n');
      });
    }

    // Initialize MCP server
    await callMcpServer('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'j41-connect', version: '0.1.0' },
    });

    // ── 4. Connect to relay ────────────────────────────────────
    feed.logStatus('Connecting to platform relay...');
    const auth = config.resumeToken
      ? { type: 'buyer', reconnectToken: config.resumeToken }
      : { type: 'buyer', uid: config.uid };

    await relay.connect(config.apiUrl, auth);
    feed.logStatus('Connected to relay');

    // Send pre-scan data
    relay.sendPreScanDone(scanResult.directoryHash, exclusions);

    // ── 5. Handle relay events ─────────────────────────────────

    relay.onRelayError((error) => {
      feed.logError(`Relay error: ${error.message}`);
      cleanup().then(() => process.exit(1));
    });

    relay.onStatusChange((status, data) => {
      switch (status) {
        case 'active':
          feed.logStatus('Workspace active');
          break;
        case 'paused':
          feed.logStatus('Workspace paused');
          break;
        case 'aborted':
          feed.logStatus('Session aborted');
          cleanup().then(() => process.exit(0));
          break;
        case 'completed':
          feed.logStatus('Session completed');
          cleanup().then(() => process.exit(0));
          break;
        case 'agent_disconnected':
          feed.logStatus('Agent disconnected. Workspace remains open.');
          break;
        default:
          feed.logStatus(`Status: ${status}`);
      }
    });

    relay.onAgentCompletion(() => {
      feed.logStatus('Agent done. Type \'accept\' to confirm or \'abort\' to cancel.');
    });

    // ── 6. Handle MCP calls from agent ─────────────────────────

    relay.onMcpCallReceived(async (call: McpCall) => {
      const toolName = call.tool;
      const relPath = call.params?.path || '.';

      // Check exclusion list
      if (isExcluded(relPath, exclusions)) {
        const meta: OperationMetadata = {
          operation: toolName === 'list_directory' ? 'list_dir' : toolName as any,
          path: relPath,
          sovguardScore: 0,
          blocked: true,
          blockReason: 'excluded file',
        };
        feed.logOperation(meta);
        relay.sendResult({
          id: call.id,
          success: false,
          error: 'File is excluded from workspace',
          metadata: meta,
        });
        return;
      }

      // Check session transfer limit
      if (sessionTransferBytes > MAX_SESSION_TRANSFER) {
        const meta: OperationMetadata = {
          operation: toolName as any,
          path: relPath,
          sovguardScore: 0,
          blocked: true,
          blockReason: 'session transfer limit exceeded (500MB)',
        };
        feed.logOperation(meta);
        relay.sendResult({
          id: call.id,
          success: false,
          error: 'Session transfer limit exceeded',
          metadata: meta,
        });
        return;
      }

      // For supervised writes: intercept and prompt before executing
      if (config.mode === 'supervised' && toolName === 'write_file' && supervisor) {
        const approved = await supervisor.promptWriteApproval(
          relPath,
          call.params.content,
          config.projectDir,
        );

        if (!approved) {
          const meta: OperationMetadata = {
            operation: 'write',
            path: relPath,
            sizeBytes: Buffer.byteLength(call.params.content, 'utf-8'),
            sovguardScore: 0,
            approved: false,
          };
          feed.logOperation(meta, false);
          relay.sendResult({
            id: call.id,
            success: false,
            error: 'Write rejected by buyer',
            metadata: meta,
          });
          return;
        }
      }

      // Execute via MCP server in Docker
      try {
        const result = await callMcpServer('tools/call', {
          name: toolName,
          arguments: call.params,
        });

        const mcpMeta = result._meta || {};
        const sizeBytes = mcpMeta.sizeBytes || 0;
        sessionTransferBytes += sizeBytes;

        const operation = toolName === 'list_directory' ? 'list_dir' : toolName;
        const meta: OperationMetadata = {
          operation: operation as any,
          path: mcpMeta.path || relPath,
          sizeBytes,
          contentHash: mcpMeta.contentHash,
          sovguardScore: 0, // v1: no real-time scanning
          approved: toolName === 'write_file' ? true : undefined,
          blocked: !!result.isError,
          blockReason: result.isError ? result.content?.[0]?.text : undefined,
        };

        feed.logOperation(meta, toolName === 'write_file' ? true : undefined);

        relay.sendResult({
          id: call.id,
          success: !result.isError,
          result: result.isError ? undefined : result,
          error: result.isError ? result.content?.[0]?.text : undefined,
          metadata: meta,
        });
      } catch (err: any) {
        const meta: OperationMetadata = {
          operation: toolName as any,
          path: relPath,
          sovguardScore: 0,
          blocked: true,
          blockReason: err.message,
        };
        feed.logOperation(meta);
        relay.sendResult({
          id: call.id,
          success: false,
          error: err.message,
          metadata: meta,
        });
      }
    });

    // ── 7. Handle interactive commands ─────────────────────────

    if (supervisor) {
      supervisor.onCommand((cmd) => {
        switch (cmd) {
          case 'pause': relay.sendPause(); feed.logStatus('Pausing...'); break;
          case 'resume': relay.sendResume(); feed.logStatus('Resuming...'); break;
          case 'accept': relay.sendAccept(); feed.logStatus('Accepting...'); break;
          case 'abort': relay.sendAbort(); feed.logStatus('Aborting...'); break;
        }
      });
    } else {
      // Standard mode — simple command reader
      const { createInterface: createRL } = await import('readline');
      const rl = createRL({ input: process.stdin, terminal: false });
      rl.on('line', (line) => {
        const cmd = line.trim().toLowerCase();
        switch (cmd) {
          case 'pause': relay.sendPause(); feed.logStatus('Pausing...'); break;
          case 'resume': relay.sendResume(); feed.logStatus('Resuming...'); break;
          case 'accept': relay.sendAccept(); feed.logStatus('Accepting...'); break;
          case 'abort': relay.sendAbort(); feed.logStatus('Aborting...'); break;
        }
      });
    }

    feed.logStatus('Waiting for agent to connect...');
    feed.logStatus('Commands: pause | resume | accept | abort');

    // Keep the process alive
    await new Promise(() => {}); // Never resolves — exits via signal/status handlers

  } catch (err: any) {
    feed.logError(err.message);
    await cleanup();
    process.exit(1);
  }
}
