/**
 * Docker container lifecycle
 *
 * Creates a Node.js Alpine container with the project directory
 * mounted read-write. The MCP server runs inside via stdio.
 */

import Docker from 'dockerode';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Writable, Readable, PassThrough } from 'stream';
import chalk from 'chalk';

const CONTAINER_NAME_PREFIX = 'j41-connect-';
const MCP_IMAGE = 'node:18-alpine';
const WORKSPACE_MOUNT = '/workspace';

export class DockerManager {
  private docker: Docker;
  private container: Docker.Container | null = null;
  private containerStream: any = null;

  constructor() {
    this.docker = new Docker();
  }

  async start(projectDir: string, mcpServerPath: string): Promise<{
    stdin: Writable;
    stdout: Readable;
  }> {
    // Pull image if needed
    try {
      await this.docker.getImage(MCP_IMAGE).inspect();
    } catch {
      console.log(chalk.gray(`Pulling ${MCP_IMAGE}...`));
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(MCP_IMAGE, (err: any, stream: any) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (err2: any) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });
    }

    const containerName = CONTAINER_NAME_PREFIX + Date.now();

    this.container = await this.docker.createContainer({
      Image: MCP_IMAGE,
      name: containerName,
      Cmd: ['node', '/app/mcp-server.js'],
      WorkingDir: WORKSPACE_MOUNT,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        Binds: [
          `${projectDir}:${WORKSPACE_MOUNT}:rw`,
          `${mcpServerPath}:/app/mcp-server.js:ro`,
        ],
        NetworkMode: 'none', // No network access
        Memory: 512 * 1024 * 1024, // 512MB
        MemorySwap: 512 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 100000, // 1 CPU core
        PidsLimit: 64,
        ReadonlyRootfs: false, // Need writable for /tmp
        SecurityOpt: ['no-new-privileges'],
      },
    });

    // Attach to container stdio
    this.containerStream = await this.container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    });

    await this.container.start();

    // Demux stdout/stderr from the multiplexed stream
    // PassThrough is both readable and writable — required by dockerode's demuxStream
    const stdout = new PassThrough();
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        // Log stderr from container (debug info)
        const msg = chunk.toString().trim();
        if (msg) console.error(chalk.gray(`[docker] ${msg}`));
        callback();
      },
    });

    this.docker.modem.demuxStream(this.containerStream, stdout, stderr);

    return {
      stdin: this.containerStream,
      stdout,
    };
  }

  async stop(): Promise<void> {
    if (!this.container) return;

    try {
      const info = await this.container.inspect();
      if (info.State.Running) {
        await this.container.stop({ t: 5 });
      }
    } catch {
      // Container may already be stopped
    }

    try {
      await this.container.remove({ force: true });
    } catch {
      // Container may already be removed
    }

    this.container = null;
    this.containerStream = null;
  }

  isRunning(): boolean {
    return this.container !== null;
  }
}

/**
 * Get the path to the compiled mcp-server.js
 * This file gets volume-mounted into the Docker container.
 */
export function getMcpServerPath(): string {
  // In production (installed via yarn global): resolve from package directory
  // In development: resolve from dist/
  const thisFile = fileURLToPath(import.meta.url);
  const distDir = dirname(thisFile);
  return resolve(distDir, 'mcp-server.js');
}
