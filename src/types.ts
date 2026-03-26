/**
 * Shared types and constants for j41-connect
 */

// ── Constants ───────────────────────────────────────────────────

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_SESSION_TRANSFER = 500 * 1024 * 1024; // 500MB
export const MAX_DIR_ENTRIES = 10_000;
export const DIFF_PREVIEW_LINES = 20;
export const RECONNECT_GRACE_SECONDS = 300; // 5 minutes

// Patterns to auto-exclude during pre-scan
export const AUTO_EXCLUDE_PATTERNS = [
  // Environment and secrets
  '.env', '.env.*', 'secrets.*',
  // SSH and GPG
  '.ssh/', '.gnupg/',
  // Cryptographic keys and certificates
  '*.pem', '*.key', '*.p12', '*.pfx', '*.jks',
  // Bare private keys
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  // Credentials files
  'credentials.json', 'serviceAccountKey.json', 'gcp-key.json',
  '.npmrc', '.pypirc', '.netrc', '.htpasswd',
  // Infrastructure secrets
  '*.tfvars', '*.tfvars.json',
  'kubeconfig', '*.kubeconfig',
  'docker-config.json',
  // Package and VCS
  'node_modules/', '.git/',
  // OS metadata
  '.DS_Store', 'Thumbs.db',
];

// ── Types ───────────────────────────────────────────────────────

export type WorkspaceMode = 'supervised' | 'standard';

export interface WorkspaceConfig {
  projectDir: string;
  uid: string;
  resumeToken?: string;
  permissions: { read: boolean; write: boolean };
  mode: WorkspaceMode;
  verbose: boolean;
  apiUrl: string;
  sovguard?: {
    apiKey: string;
    apiUrl: string;
  };
}

export interface ExclusionEntry {
  path: string;
  reason: string;
}

export interface OperationMetadata {
  operation: 'read' | 'read_file' | 'write' | 'write_file' | 'list_dir' | 'list_directory' | 'search' | 'search_files' | 'get_file_info' | 'directory_tree';
  path: string;
  sizeBytes?: number;
  contentHash?: string;
  sovguardScore: number;
  approved?: boolean;
  blocked?: boolean;
  blockReason?: string;
}

export interface McpCall {
  id: string;
  tool: string;
  params: Record<string, any>;
}

export interface McpResult {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
  metadata: OperationMetadata;
}

export interface SessionStats {
  reads: number;
  writes: number;
  blocked: number;
  totalBytes: number;
  startedAt: number;
}

// Stdin state machine for command/approval coexistence
export type InputState = 'IDLE' | 'APPROVAL_PENDING';

export interface ChatMessage {
  id: string;
  senderVerusId: string;
  content: string;
  safetyScore: number | null;
  safetyWarning: boolean;
  safetyDetail?: { classification: string; flags: string[] } | null;
  createdAt: string;
}

export interface AgentMeta {
  agentName: string | null;
  agentVerusId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  jobId: string | null;
}
