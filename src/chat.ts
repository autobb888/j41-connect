// /home/bigbox/code/j41-connect/src/chat.ts
import chalk from 'chalk';
import type { ChatMessage, AgentMeta } from './types.js';

// ── Model-Adaptive Theming ─────────────────────────────────

interface Theme {
  prefix: string;
  color: (s: string) => string;
}

const THEMES: Record<string, Theme> = {
  anthropic: { prefix: 'claude', color: chalk.hex('#E87B35') },
  openai:    { prefix: 'gpt',    color: chalk.green },
  google:    { prefix: 'gemini', color: chalk.blue },
  xai:       { prefix: 'grok',   color: chalk.white },
  mistral:   { prefix: 'mistral', color: chalk.hex('#FF7000') },
  deepseek:  { prefix: 'deepseek', color: chalk.cyan },
  moonshot:  { prefix: 'kimi',   color: chalk.hex('#6366f1') },
  meta:      { prefix: 'llama',  color: chalk.hex('#0084FF') },
};

const DEFAULT_THEME: Theme = { prefix: 'agent', color: chalk.hex('#818cf8') };
const BUYER_COLOR = chalk.hex('#34d399');

function getAgentTheme(meta: AgentMeta): Theme {
  if (meta.modelProvider) {
    const key = meta.modelProvider.toLowerCase();
    if (THEMES[key]) return THEMES[key];
  }
  return DEFAULT_THEME;
}

// ── Display ────────────────────────────────────────────────

// Uses agentVerusId to distinguish sender instead of buyerVerusId
// (buyerVerusId doesn't exist in WorkspaceConfig).
// Any message NOT from the agent is rendered as "you ›".

export function formatChatMessage(
  msg: ChatMessage,
  agentVerusId: string | null,
  meta: AgentMeta,
): string {
  const isAgent = agentVerusId && msg.senderVerusId === agentVerusId;
  const theme = getAgentTheme(meta);

  let prefix: string;
  if (isAgent) {
    prefix = theme.color(`${theme.prefix} ›`);
  } else {
    prefix = BUYER_COLOR('you ›');
  }

  let line = `${prefix} ${msg.content}`;

  // Safety warning
  if (msg.safetyWarning && msg.safetyDetail) {
    const flags = msg.safetyDetail.flags.join(', ');
    line = `${chalk.yellow('⚠')} ${prefix} ${chalk.dim(`[${flags}]`)} ${msg.content}`;
  }

  return line;
}

export function printChatHistory(
  messages: ChatMessage[],
  agentVerusId: string | null,
  meta: AgentMeta,
): void {
  if (messages.length === 0) return;

  console.log(chalk.dim('─── chat history ─────────────────────────────────'));
  for (const msg of messages) {
    console.log(formatChatMessage(msg, agentVerusId, meta));
  }
  console.log(chalk.dim('─── live ─────────────────────────────────────────'));
}

export function printChatLine(
  msg: ChatMessage,
  agentVerusId: string | null,
  meta: AgentMeta,
): void {
  console.log(formatChatMessage(msg, agentVerusId, meta));
}
