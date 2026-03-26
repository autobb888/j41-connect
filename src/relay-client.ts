/**
 * Socket.IO client to platform's /workspace namespace
 *
 * Handles connection, authentication (UID or reconnect token),
 * MCP call routing, and status events.
 */

import { io, Socket } from 'socket.io-client';
import chalk from 'chalk';
import type { McpCall, McpResult, ExclusionEntry, ChatMessage, AgentMeta } from './types.js';

export class RelayClient {
  private socket: Socket | null = null;
  private onMcpCall: ((call: McpCall) => void) | null = null;
  private onStatusChanged: ((status: string, data?: any) => void) | null = null;
  private onAgentDone: (() => void) | null = null;
  private onError: ((error: { code: string; message: string }) => void) | null = null;
  private onChatMsg: ((msg: ChatMessage) => void) | null = null;
  public agentMeta: AgentMeta = { agentName: null, agentVerusId: null, modelProvider: null, modelName: null, jobId: null };

  connect(apiUrl: string, auth: { type: string; uid?: string; reconnectToken?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      // Connect to /workspace namespace (append to URL, path is HTTP transport path)
      this.socket = io(apiUrl + '/workspace', {
        path: '/ws',
        auth,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      this.socket.on('connect', () => {
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        reject(new Error(`Connection failed: ${err.message}`));
      });

      // MCP tool calls from agent (via relay)
      this.socket.on('mcp:call', (data: McpCall) => {
        this.onMcpCall?.(data);
      });

      // Chat messages from agent
      this.socket.on('chat:message', (data: ChatMessage) => {
        this.onChatMsg?.(data);
      });

      // Status changes
      this.socket.on('workspace:status_changed', (data: any) => {
        if (data.agentName !== undefined) {
          this.agentMeta = {
            agentName: data.agentName ?? null,
            agentVerusId: data.agentVerusId ?? null,
            modelProvider: data.modelProvider ?? null,
            modelName: data.modelName ?? null,
            jobId: data.jobId ?? null,
          };
        }
        this.onStatusChanged?.(data.status, data);
      });

      // Agent signals completion
      this.socket.on('workspace:agent_done', () => {
        this.onAgentDone?.();
      });

      // Agent disconnected
      this.socket.on('workspace:agent_disconnected', (data: any) => {
        this.onStatusChanged?.('agent_disconnected', data);
      });

      // Relay errors
      this.socket.on('ws:error', (data: { code: string; message: string }) => {
        this.onError?.(data);
      });

      this.socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect') {
          // Server disconnected us — don't auto-reconnect
          this.onStatusChanged?.('disconnected', { reason: 'server' });
        }
      });
    });
  }

  sendResult(result: McpResult): void {
    this.socket?.emit('mcp:result', result);
  }

  sendPreScanDone(directoryHash: string, exclusions: ExclusionEntry[], overrides?: string[]): void {
    this.socket?.emit('workspace:pre_scan_done', {
      directoryHash,
      excludedFiles: exclusions.map((e) => e.path),
      exclusionOverrides: overrides,
    });
  }

  sendChatMessage(content: string): void {
    this.socket?.emit('chat:message', { content });
  }

  sendPause(): void { this.socket?.emit('workspace:pause'); }
  sendResume(): void { this.socket?.emit('workspace:resume'); }
  sendAbort(): void { this.socket?.emit('workspace:abort'); }
  sendAccept(): void { this.socket?.emit('workspace:accept'); }

  onMcpCallReceived(handler: (call: McpCall) => void): void { this.onMcpCall = handler; }
  onStatusChange(handler: (status: string, data?: any) => void): void { this.onStatusChanged = handler; }
  onAgentCompletion(handler: () => void): void { this.onAgentDone = handler; }
  onRelayError(handler: (error: { code: string; message: string }) => void): void { this.onError = handler; }
  onChatMessageReceived(handler: (msg: ChatMessage) => void): void { this.onChatMsg = handler; }

  fetchChatHistory(limit: number = 15): Promise<ChatMessage[]> {
    return new Promise((resolve) => {
      if (!this.socket) { resolve([]); return; }
      const resolved = { done: false };
      this.socket.emit('chat:history', { limit }, (response: any) => {
        if (resolved.done) return;
        resolved.done = true;
        const messages: ChatMessage[] = (response?.data || []).map((m: any) => ({
          id: m.id,
          senderVerusId: m.sender_verus_id || m.senderVerusId,
          content: m.content,
          safetyScore: m.safety_score ?? m.safetyScore ?? null,
          safetyWarning: (m.safety_score ?? m.safetyScore ?? 0) >= 0.4,
          safetyDetail: m.safetyDetail || null,
          createdAt: m.created_at || m.createdAt,
        }));
        resolve(messages);
      });
      setTimeout(() => {
        if (!resolved.done) {
          resolved.done = true;
          resolve([]);
        }
      }, 5000);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
