import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

export async function currentCommit(cwd: string): Promise<string | null> {
  try {
    return await git(["rev-parse", "HEAD"], cwd);
  } catch {
    return null;
  }
}

export async function currentRef(cwd: string): Promise<string | null> {
  try {
    return await git(["branch", "--show-current"], cwd);
  } catch {
    return null;
  }
}

export async function repoUrl(cwd: string): Promise<string | null> {
  try {
    return await git(["config", "--get", "remote.origin.url"], cwd);
  } catch {
    return null;
  }
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const status = await git(["status", "--porcelain"], cwd);
  return status.length === 0;
}

export async function workingTreeStatus(cwd: string): Promise<string> {
  return await git(["status", "--porcelain"], cwd);
}

export async function commitAll(cwd: string, message: string): Promise<string | null> {
  if (await isWorkingTreeClean(cwd)) return null;
  await git(["add", "-A"], cwd);
  await git(["commit", "-m", message], cwd);
  return await currentCommit(cwd);
}

export async function pushCurrentBranch(cwd: string): Promise<void> {
  const branch = await currentRef(cwd);
  if (!branch) {
    throw new Error("Cannot push because HEAD is detached");
  }
  await git(["push", "-u", "origin", branch], cwd);
}

export async function fetchRef(cwd: string, remoteUrl: string | null, ref: string | null): Promise<void> {
  if (!ref) return;
  if (remoteUrl) {
    await git(["fetch", remoteUrl, ref], cwd);
    return;
  }
  await git(["fetch", "origin", ref], cwd);
}

export async function checkoutCommit(cwd: string, commit: string): Promise<void> {
  await git(["checkout", commit], cwd);
}
