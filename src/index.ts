#!/usr/bin/env node

import { parseArgs, run } from './cli.js';

async function main() {
  // Route subcommands before commander processes <directory>
  if (process.argv[2] === 'config') {
    const { handleConfigCommand } = await import('./config.js');
    await handleConfigCommand(process.argv.slice(3));
    process.exit(0);
  }

  if (process.argv[2] === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    await runDoctor();
    process.exit(0);
  }

  const config = parseArgs(process.argv);
  await run(config);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
