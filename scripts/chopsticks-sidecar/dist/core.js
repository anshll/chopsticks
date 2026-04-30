import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadConfig } from "./config.js";
import { checkoutCommit, commitAll, currentCommit, currentRef, fetchRef, isWorkingTreeClean, pushCurrentBranch, repoUrl, workingTreeStatus } from "./git.js";
import { importSnapshot, latestCodexSession, prepareSnapshot, restoreSnapshotToSession } from "./session.js";
import { SupabaseRest } from "./supabase.js";
export function client() {
    const config = loadConfig();
    return { config, supabase: new SupabaseRest(config) };
}
export async function listRooms() {
    const { supabase } = client();
    return { rooms: await supabase.listRooms() };
}
export async function listChats(args) {
    const { supabase } = client();
    return { chats: await supabase.listChats(args.roomId) };
}
export async function createRoom(args) {
    const { supabase } = client();
    return await supabase.createRoom(args);
}
export async function createChat(args) {
    const { supabase } = client();
    return await supabase.createChat({
        roomId: args.roomId,
        title: args.title || "Shared Codex chat"
    });
}
export async function status(args) {
    const { supabase } = client();
    return await supabase.getStatus(args.roomId, args.chatId);
}
export async function acquireLock(args, ctx) {
    const { supabase } = client();
    return await supabase.acquireLock({
        roomId: args.roomId,
        chatId: args.chatId,
        task: args.task || null,
        baseGitRef: await currentRef(ctx.cwd),
        baseGitCommit: await currentCommit(ctx.cwd),
        leaseSeconds: args.leaseSeconds || 300
    });
}
export async function renewLock(args) {
    const { supabase } = client();
    return await supabase.renewLock(args.roomId, args.chatId, args.leaseSeconds || 300);
}
export async function releaseLock(args) {
    const { supabase } = client();
    await supabase.releaseLock(args.roomId, args.chatId);
    return { released: true };
}
export async function finishControl(args, ctx) {
    const statusText = await workingTreeStatus(ctx.cwd);
    const hasLocalChanges = statusText.length > 0;
    if (hasLocalChanges && args.declineLocalChanges) {
        const handoff = await createHandoff({
            roomId: args.roomId,
            chatId: args.chatId,
            summary: args.summary,
            sessionPath: args.sessionPath,
            codexVersion: args.codexVersion,
            allowSensitiveTranscript: args.allowSensitiveTranscript
        }, ctx);
        if (isBlocked(handoff))
            return handoff;
        await releaseLock({ roomId: args.roomId, chatId: args.chatId });
        return {
            ok: true,
            released: true,
            handoffCreated: true,
            codeUpdated: false,
            handoff,
            reason: "user_declined_local_changes_but_transcript_synced",
            localChanges: statusText
        };
    }
    if (hasLocalChanges && args.commitAndPush !== true) {
        return {
            ok: false,
            blocked: true,
            reason: "local_changes_require_commit_push_or_decline",
            localChanges: statusText
        };
    }
    let committed = null;
    if (hasLocalChanges) {
        committed = await commitAll(ctx.cwd, args.commitMessage || args.summary);
        await pushCurrentBranch(ctx.cwd);
    }
    const handoff = await createHandoff({
        roomId: args.roomId,
        chatId: args.chatId,
        summary: args.summary,
        sessionPath: args.sessionPath,
        codexVersion: args.codexVersion,
        allowSensitiveTranscript: args.allowSensitiveTranscript
    }, ctx);
    if (isBlocked(handoff))
        return handoff;
    await releaseLock({ roomId: args.roomId, chatId: args.chatId });
    return { ok: true, committed, handoff, released: true };
}
export async function comment(args) {
    const { supabase } = client();
    return await supabase.createMessage(args.roomId, args.chatId, args.body);
}
export async function createHandoff(args, ctx) {
    const { config, supabase } = client();
    const sessionPath = args.sessionPath || await latestCodexSession();
    const snapshot = await prepareSnapshot(sessionPath);
    if (snapshot.warnings.length > 0 && !args.allowSensitiveTranscript) {
        return { ok: false, blocked: true, warnings: snapshot.warnings };
    }
    const handoffId = randomUUID();
    const gitRepoUrl = await repoUrl(ctx.cwd);
    const gitRef = await currentRef(ctx.cwd);
    const gitCommit = await currentCommit(ctx.cwd);
    const storagePath = `rooms/${args.roomId}/chats/${args.chatId}/handoffs/${handoffId}/session.jsonl`;
    await supabase.uploadObject(storagePath, snapshot.bytes);
    const handoff = await supabase.createHandoff({
        id: handoffId,
        room_id: args.roomId,
        chat_id: args.chatId,
        created_by: config.userId,
        summary: args.summary,
        snapshot_storage_path: storagePath,
        snapshot_sha256: snapshot.sha256,
        git_repo_url: gitRepoUrl,
        git_ref: gitRef,
        git_commit: gitCommit,
        codex_version: args.codexVersion || null,
        plugin_version: config.pluginVersion,
        created_at: new Date().toISOString()
    });
    const metadata = {
        schema_version: "1.0",
        room_id: args.roomId,
        chat_id: args.chatId,
        handoff_id: handoff.id,
        created_by: config.userId,
        created_at: handoff.created_at,
        git: { repo_url: gitRepoUrl, ref: gitRef, commit: gitCommit },
        codex: {
            version: args.codexVersion || null,
            session_id: snapshot.sessionId,
            original_cwd: path.resolve(ctx.cwd)
        },
        snapshot: { storage_path: storagePath, sha256: snapshot.sha256 }
    };
    return { ok: true, handoff, metadata, warnings: snapshot.warnings };
}
function isBlocked(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.blocked === true);
}
export async function applyLatestHandoff(args, ctx) {
    const { supabase } = client();
    const roomStatus = await supabase.getStatus(args.roomId, args.chatId);
    if (!roomStatus.latestHandoff) {
        throw new Error("No handoff exists for this room/chat");
    }
    if (args.requireCleanTree !== false && !await isWorkingTreeClean(ctx.cwd)) {
        return { ok: false, blocked: true, reason: "working_tree_not_clean" };
    }
    const handoff = roomStatus.latestHandoff;
    if (handoff.git_ref) {
        await fetchRef(ctx.cwd, handoff.git_repo_url, handoff.git_ref);
    }
    if (args.checkout !== false && handoff.git_commit) {
        await checkoutCommit(ctx.cwd, handoff.git_commit);
    }
    const bytes = await supabase.downloadObject(handoff.snapshot_storage_path);
    if (args.targetSessionPath) {
        const restored = await restoreSnapshotToSession(bytes, handoff.snapshot_sha256, args.targetSessionPath);
        return { ok: true, handoff, ...restored, mode: "selected_session_refreshed" };
    }
    const restoredPath = await importSnapshot(bytes, handoff.snapshot_sha256, args.roomId, args.chatId, handoff.id);
    return { ok: true, handoff, restoredPath, mode: "restored_session_file" };
}
