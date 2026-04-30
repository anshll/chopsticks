#!/usr/bin/env node
import { createInterface } from "node:readline";
import { acquireLock, applyLatestHandoff, comment, createChat, createHandoff, createRoom, finishControl, listChats, listRooms, releaseLock, renewLock, status } from "./core.js";
const tools = [
    {
        name: "chopsticks_list_rooms",
        description: "List Chopsticks rooms visible to the current user.",
        inputSchema: objectSchema({}, [])
    },
    {
        name: "chopsticks_list_chats",
        description: "List chats in a Chopsticks room.",
        inputSchema: objectSchema({ roomId: { type: "string" } }, ["roomId"])
    },
    {
        name: "chopsticks_create_room",
        description: "Create a Chopsticks room linked to a GitHub repository URL and create its first chat.",
        inputSchema: objectSchema({
            name: { type: "string" },
            repoUrl: { type: "string" }
        }, ["name", "repoUrl"])
    },
    {
        name: "chopsticks_create_chat",
        description: "Create an additional independently locked chat within an existing Chopsticks room.",
        inputSchema: objectSchema({
            roomId: { type: "string" },
            title: { type: "string" }
        }, ["roomId"])
    },
    {
        name: "chopsticks_status",
        description: "Get lock and latest handoff status for a Chopsticks room chat.",
        inputSchema: roomChatSchema()
    },
    {
        name: "chopsticks_acquire_lock",
        description: "Acquire per-chat control if no active unexpired lease exists.",
        inputSchema: objectSchema({
            ...roomChatProps(),
            task: { type: "string" },
            leaseSeconds: { type: "number", default: 300 }
        }, ["roomId", "chatId"])
    },
    {
        name: "chopsticks_renew_lock",
        description: "Renew the current user's per-chat lock lease.",
        inputSchema: objectSchema({ ...roomChatProps(), leaseSeconds: { type: "number", default: 300 } }, ["roomId", "chatId"])
    },
    {
        name: "chopsticks_release_lock",
        description: "Release the current user's per-chat lock.",
        inputSchema: roomChatSchema()
    },
    {
        name: "chopsticks_comment",
        description: "Create a human side-comment in the shared Chopsticks chat.",
        inputSchema: objectSchema({ ...roomChatProps(), body: { type: "string" } }, ["roomId", "chatId", "body"])
    },
    {
        name: "chopsticks_create_handoff",
        description: "Upload the latest Codex session snapshot and create a Git-backed handoff.",
        inputSchema: objectSchema({
            ...roomChatProps(),
            summary: { type: "string" },
            sessionPath: { type: "string" },
            codexVersion: { type: "string" },
            allowSensitiveTranscript: { type: "boolean", default: false }
        }, ["roomId", "chatId", "summary"])
    },
    {
        name: "chopsticks_finish_control",
        description: "Finish a controlled chat: commit and push local changes unless declined, create a handoff, then release the lock.",
        inputSchema: objectSchema({
            ...roomChatProps(),
            summary: { type: "string" },
            commitMessage: { type: "string" },
            commitAndPush: { type: "boolean", default: true },
            declineLocalChanges: { type: "boolean", default: false },
            sessionPath: { type: "string" },
            codexVersion: { type: "string" },
            allowSensitiveTranscript: { type: "boolean", default: false }
        }, ["roomId", "chatId", "summary"])
    },
    {
        name: "chopsticks_apply_latest_handoff",
        description: "Fetch Git state and import the latest transcript snapshot as a restored session, or refresh a specific Codex session when targetSessionPath is provided.",
        inputSchema: objectSchema({
            ...roomChatProps(),
            checkout: { type: "boolean", default: true },
            requireCleanTree: { type: "boolean", default: true },
            targetSessionPath: { type: "string" }
        }, ["roomId", "chatId"])
    }
];
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => {
    void handleLine(line);
});
async function handleLine(line) {
    if (!line.trim())
        return;
    const request = JSON.parse(line);
    try {
        const result = await handleRequest(request.method || "", request.params || {});
        respond({ jsonrpc: "2.0", id: request.id ?? null, result });
    }
    catch (error) {
        respond({
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
        });
    }
}
async function handleRequest(method, params) {
    if (method === "initialize") {
        return {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "chopsticks", version: "0.1.0" }
        };
    }
    if (method === "tools/list")
        return { tools };
    if (method !== "tools/call")
        return {};
    const name = String(params.name || "");
    const args = (params.arguments || {});
    const result = await callTool(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
async function callTool(name, args) {
    const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
    switch (name) {
        case "chopsticks_list_rooms":
            return listRooms();
        case "chopsticks_list_chats":
            return listChats({ roomId: asString(args.roomId, "roomId") });
        case "chopsticks_create_room":
            return createRoom({
                name: asString(args.name, "name"),
                repoUrl: asString(args.repoUrl, "repoUrl")
            });
        case "chopsticks_create_chat":
            return createChat({
                roomId: asString(args.roomId, "roomId"),
                title: asOptionalString(args.title)
            });
        case "chopsticks_status":
            return status(asRoomChat(args));
        case "chopsticks_acquire_lock":
            return acquireLock({ ...asRoomChat(args), task: asOptionalString(args.task), leaseSeconds: asOptionalNumber(args.leaseSeconds) }, { cwd });
        case "chopsticks_renew_lock":
            return renewLock({ ...asRoomChat(args), leaseSeconds: asOptionalNumber(args.leaseSeconds) });
        case "chopsticks_release_lock":
            return releaseLock(asRoomChat(args));
        case "chopsticks_comment":
            return comment({ ...asRoomChat(args), body: asString(args.body, "body") });
        case "chopsticks_create_handoff":
            return createHandoff({
                ...asRoomChat(args),
                summary: asString(args.summary, "summary"),
                sessionPath: asOptionalString(args.sessionPath),
                codexVersion: asOptionalString(args.codexVersion),
                allowSensitiveTranscript: Boolean(args.allowSensitiveTranscript)
            }, { cwd });
        case "chopsticks_finish_control":
            return finishControl({
                ...asRoomChat(args),
                summary: asString(args.summary, "summary"),
                commitMessage: asOptionalString(args.commitMessage),
                commitAndPush: args.commitAndPush !== false,
                declineLocalChanges: Boolean(args.declineLocalChanges),
                sessionPath: asOptionalString(args.sessionPath),
                codexVersion: asOptionalString(args.codexVersion),
                allowSensitiveTranscript: Boolean(args.allowSensitiveTranscript)
            }, { cwd });
        case "chopsticks_apply_latest_handoff":
            return applyLatestHandoff({
                ...asRoomChat(args),
                checkout: args.checkout !== false,
                requireCleanTree: args.requireCleanTree !== false,
                targetSessionPath: asOptionalString(args.targetSessionPath)
            }, { cwd });
        default:
            throw new Error(`Unknown tool ${name}`);
    }
}
function respond(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
function asRoomChat(args) {
    return { roomId: asString(args.roomId, "roomId"), chatId: asString(args.chatId, "chatId") };
}
function asString(value, name) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Missing ${name}`);
    return value;
}
function asOptionalString(value) {
    return typeof value === "string" ? value : undefined;
}
function asOptionalNumber(value) {
    return typeof value === "number" ? value : undefined;
}
function roomChatSchema() {
    return objectSchema(roomChatProps(), ["roomId", "chatId"]);
}
function roomChatProps() {
    return {
        roomId: { type: "string" },
        chatId: { type: "string" },
        cwd: { type: "string" }
    };
}
function objectSchema(properties, required) {
    return { type: "object", properties, required };
}
