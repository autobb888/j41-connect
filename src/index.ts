#!/usr/bin/env node

import { parseArgs, run } from './cli.js';

async function main() {
  const config = parseArgs(process.argv);
  await run(config);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
