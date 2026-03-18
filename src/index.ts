#!/usr/bin/env node

/**
 * j41-connect — Connect hired AI agents to your local project
 *
 * Usage: j41-connect <dir> --uid <token> [--read] [--write] [--supervised|--standard] [--verbose]
 */

import { parseArgs } from './cli.js';

async function main() {
  const config = parseArgs(process.argv);
  // Orchestration will be added in Task 9
  console.log('j41-connect starting...', config);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
