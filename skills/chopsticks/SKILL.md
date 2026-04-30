---
name: chopsticks
description: Coordinate turn-based Codex Desktop collaboration through Chopsticks rooms, per-chat lock leases, Git-backed handoffs, Supabase transcript snapshots, and durable human comments.
---

# Chopsticks Collaboration

Use this skill when a user asks to collaborate through Chopsticks, take or leave control of a shared Codex chat, publish a handoff, apply a handoff, or inspect room state.

## Operating Model

- Treat GitHub as the source of truth for code.
- Treat Supabase Postgres as the source of truth for rooms, chats, locks, handoffs, messages, and events.
- Treat Supabase Storage as the source of truth for raw Codex JSONL session snapshots.
- Treat Supabase Realtime as notification-only. Do not send raw transcript blobs over Realtime.
- Locks are per chat, not per room. Only one user can control a specific chat at a time.
- Viewers may comment while another user holds control.

## Default Workflow

1. When creating a room, ask the user for the GitHub repository URL. Store it on the room with `chopsticks_create_room`.
2. Create additional chats with `chopsticks_create_chat`; each chat is synced and locked independently.
3. Check room/chat status with the `chopsticks_status` MCP tool.
4. Before editing or prompting on behalf of a shared chat, acquire the lock with `chopsticks_acquire_lock`.
5. While holding control, renew the lock periodically with `chopsticks_renew_lock`; the default idle lease is 5 minutes.
6. When finished, push code to GitHub first.
7. Create a handoff with `chopsticks_create_handoff`; include a concise summary, the latest Git ref, and commit.
8. Release the lock with `chopsticks_release_lock`.

## Applying a Handoff

1. Check that the local working tree is clean or get explicit user confirmation before changing Git state.
2. Fetch the Git ref/commit from the handoff.
3. Download and verify the transcript snapshot hash.
4. Import the snapshot as a restored session or backup file. Do not blindly overwrite an active Codex session.
5. Record `handoff.applied` or `handoff.failed`.

## Safety Rules

- Never overwrite active session files.
- Create a backup before writing any session file.
- Validate JSONL before applying a transcript.
- Verify snapshot SHA-256 after download.
- Warn if the transcript contains likely secrets.
- If Git repo URL, commit, plugin version, runtime, or required tools are incompatible, keep the transcript view-only until the user resolves the mismatch.

## Useful User-Facing Phrases

- "You can watch and comment, but this chat is currently locked by another user."
- "The latest handoff is ready. I can sync the Git commit and restore the transcript."
- "I found possible secrets in the transcript, so I am not uploading until you confirm."
