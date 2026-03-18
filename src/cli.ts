/**
 * CLI argument parsing and main orchestration
 */

import { Command } from 'commander';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import type { WorkspaceConfig } from './types.js';

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
