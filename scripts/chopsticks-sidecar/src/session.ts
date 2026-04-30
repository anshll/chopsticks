import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface SnapshotCandidate {
  path: string;
  bytes: Buffer;
  sha256: string;
  warnings: string[];
  sessionId: string | null;
}

export interface SessionSummary {
  path: string;
  modifiedAt: string;
  bytes: number;
  cwd: string | null;
  sessionId: string | null;
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/
];

export async function latestCodexSession(sessionRoot = defaultSessionRoot()): Promise<string> {
  const sessions = await listRecentCodexSessions(sessionRoot, 1);
  if (sessions.length === 0) {
    throw new Error(`No Codex JSONL session files found under ${sessionRoot}`);
  }
  return sessions[0].path;
}

export async function listRecentCodexSessions(sessionRoot = defaultSessionRoot(), limit = 20): Promise<SessionSummary[]> {
  const files = await walkJsonl(sessionRoot);
  const withStats = await Promise.all(files.map(async file => ({ file, stats: await stat(file) })));
  withStats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  const recent = withStats.slice(0, Math.max(1, limit));
  return await Promise.all(recent.map(async ({ file, stats }) => ({
    path: file,
    modifiedAt: stats.mtime.toISOString(),
    bytes: stats.size,
    ...await readSessionSummary(file)
  })));
}

export async function prepareSnapshot(filePath: string): Promise<SnapshotCandidate> {
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  validateJsonl(text, filePath);

  return {
    path: filePath,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    warnings: scanForSecrets(text),
    sessionId: extractSessionId(text)
  };
}

export async function importSnapshot(bytes: Buffer, expectedSha256: string, roomId: string, chatId: string, handoffId: string): Promise<string> {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Snapshot hash mismatch: expected ${expectedSha256}, got ${actual}`);
  }
  validateJsonl(bytes.toString("utf8"), "downloaded snapshot");

  const targetDir = path.join(defaultSessionRoot(), "chopsticks-restored", roomId, chatId);
  await mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, `${handoffId}-${randomUUID()}.jsonl`);
  await writeFile(target, bytes, { flag: "wx" });
  return target;
}

export async function restoreSnapshotToSession(bytes: Buffer, expectedSha256: string, targetSessionPath: string): Promise<{ restoredPath: string; backupPath: string; sessionId: string | null }> {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Snapshot hash mismatch: expected ${expectedSha256}, got ${actual}`);
  }
  const text = bytes.toString("utf8");
  validateJsonl(text, "downloaded snapshot");

  const resolvedTarget = path.resolve(targetSessionPath);
  const sessionRoot = path.resolve(defaultSessionRoot());
  if (!resolvedTarget.startsWith(`${sessionRoot}${path.sep}`) || !resolvedTarget.endsWith(".jsonl")) {
    throw new Error(`Refusing to restore transcript outside Codex sessions: ${targetSessionPath}`);
  }

  const backupPath = `${resolvedTarget}.chopsticks-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(resolvedTarget, backupPath);
  await writeFile(resolvedTarget, bytes);
  return { restoredPath: resolvedTarget, backupPath, sessionId: extractSessionId(text) };
}

function defaultSessionRoot(): string {
  return path.join(homedir(), ".codex", "sessions");
}

async function readSessionSummary(filePath: string): Promise<{ cwd: string | null; sessionId: string | null }> {
  const text = await readFile(filePath, "utf8");
  return {
    cwd: extractCwd(text),
    sessionId: extractSessionId(text)
  };
}

async function walkJsonl(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...await walkJsonl(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      found.push(full);
    }
  }
  return found;
}

function validateJsonl(text: string, label: string): void {
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    try {
      JSON.parse(lines[i]);
    } catch (error) {
      throw new Error(`Invalid JSONL in ${label} at line ${i + 1}: ${(error as Error).message}`);
    }
  }
}

function scanForSecrets(text: string): string[] {
  const warnings: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`Transcript matches sensitive pattern ${pattern.source}`);
    }
  }
  return warnings;
}

function extractSessionId(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const sessionId = parsed.session_id || parsed.sessionId || parsed.id;
      if (typeof sessionId === "string" && sessionId.length > 8) return sessionId;
      const payload = parsed.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadId = (payload as Record<string, unknown>).id;
        if (typeof payloadId === "string" && payloadId.length > 8) return payloadId;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extractCwd(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const cwd = parsed.cwd;
      if (typeof cwd === "string" && cwd.length > 0) return cwd;
      const payload = parsed.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const payloadCwd = (payload as Record<string, unknown>).cwd;
        if (typeof payloadCwd === "string" && payloadCwd.length > 0) return payloadCwd;
      }
    } catch {
      return null;
    }
  }
  return null;
}
