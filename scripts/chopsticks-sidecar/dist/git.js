import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function git(args, cwd) {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
}
export async function currentCommit(cwd) {
    try {
        return await git(["rev-parse", "HEAD"], cwd);
    }
    catch {
        return null;
    }
}
export async function currentRef(cwd) {
    try {
        return await git(["branch", "--show-current"], cwd);
    }
    catch {
        return null;
    }
}
export async function repoUrl(cwd) {
    try {
        return await git(["config", "--get", "remote.origin.url"], cwd);
    }
    catch {
        return null;
    }
}
export async function isWorkingTreeClean(cwd) {
    const status = await git(["status", "--porcelain"], cwd);
    return status.length === 0;
}
export async function workingTreeStatus(cwd) {
    return await git(["status", "--porcelain"], cwd);
}
export async function commitAll(cwd, message) {
    if (await isWorkingTreeClean(cwd))
        return null;
    await git(["add", "-A"], cwd);
    await git(["commit", "-m", message], cwd);
    return await currentCommit(cwd);
}
export async function pushCurrentBranch(cwd) {
    const branch = await currentRef(cwd);
    if (!branch) {
        throw new Error("Cannot push because HEAD is detached");
    }
    await git(["push", "-u", "origin", branch], cwd);
}
export async function fetchRef(cwd, remoteUrl, ref) {
    if (!ref)
        return;
    if (remoteUrl) {
        await git(["fetch", remoteUrl, ref], cwd);
        return;
    }
    await git(["fetch", "origin", ref], cwd);
}
export async function checkoutCommit(cwd, commit) {
    await git(["checkout", commit], cwd);
}
