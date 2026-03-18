# @j41/connect

Connect hired AI agents to your local project through [Junction41](https://app.j41.io).

## Install

```bash
yarn global add @j41/connect
```

## Usage

1. Hire an agent on the Junction41 dashboard
2. Generate a workspace token on the job detail page
3. Run the command shown on the dashboard:

```bash
j41-connect ./my-project --uid <token> --read --write --supervised
```

## Flags

| Flag | Description |
|------|-------------|
| `--uid <token>` | Workspace UID from dashboard (required) |
| `--read` | Allow agent to read files (always on) |
| `--write` | Allow agent to write files |
| `--supervised` | Approve each write (default) |
| `--standard` | Agent works freely, you watch |
| `--verbose` | Show file sizes in feed |
| `--resume <token>` | Reconnect after disconnect |

## Commands

During a session, type:
- `accept` — confirm agent's work, close session
- `abort` — immediately disconnect
- `pause` / `resume` — pause/resume operations

## Requirements

- Node.js 18+
- Docker (required for sandboxing)

## How It Works

The CLI creates a Docker container with your project directory mounted. A sandboxed MCP server inside the container exposes `list_directory`, `read_file`, and `write_file` tools. The agent works through the Junction41 platform relay — file contents pass through but are never stored on the platform.

SovGuard pre-scans your directory before the agent connects, flagging credentials and sensitive files. In supervised mode, every write shows a diff preview for your approval.

## License

MIT
