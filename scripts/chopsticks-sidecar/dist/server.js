#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock, applyLatestHandoff, comment, createChat, createRoom, finishControl, listChats, listRooms, releaseLock, status } from "./core.js";
import { latestCodexSession, listRecentCodexSessions } from "./session.js";
const port = Number(process.env.CHOPSTICKS_PANEL_PORT || 4217);
let currentWorkspace = process.env.CHOPSTICKS_WORKSPACE || process.cwd();
let currentSessionPath = process.env.CHOPSTICKS_SESSION_PATH || "";
const sidecarDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(sidecarDir, "..", "..", "..", "app");
const server = createServer((request, response) => {
    void route(request, response).catch(error => sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    }));
});
server.listen(port, "127.0.0.1", () => {
    console.log(`Chopsticks panel listening at http://127.0.0.1:${port}`);
});
async function route(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
        await routeApi(url.pathname, request, response);
        return;
    }
    await serveStatic(url.pathname, response);
}
async function routeApi(pathname, request, response) {
    const body = request.method === "GET" ? {} : await readJson(request);
    const search = new URL(request.url || "/", "http://127.0.0.1").searchParams;
    const result = await callApi(pathname, body, search);
    sendJson(response, 200, result);
}
async function callApi(pathname, body, search) {
    switch (pathname) {
        case "/api/config":
            if (Object.keys(body).length > 0) {
                applyConfig(body);
            }
            return redactedConfig();
        case "/api/auth/sign-in":
            return signInWithPassword(body);
        case "/api/health":
            return { ok: true, cwd: currentWorkspace, config: redactedConfig() };
        case "/api/sessions":
            return listSessions(search);
        case "/api/rooms":
            if (body.name || body.repoUrl) {
                return createRoom({
                    name: asString(body.name, "name"),
                    repoUrl: asString(body.repoUrl, "repoUrl")
                });
            }
            return listRooms();
        case "/api/chats":
            if (body.roomId) {
                return createChat({
                    roomId: asString(body.roomId, "roomId"),
                    title: asOptionalString(body.title)
                });
            }
            return listChats({ roomId: requiredParam(search, "roomId") });
        case "/api/status":
            return status({
                roomId: requiredParam(search, "roomId"),
                chatId: requiredParam(search, "chatId")
            });
        case "/api/acquire-lock":
            return acquireLock({
                roomId: asString(body.roomId, "roomId"),
                chatId: asString(body.chatId, "chatId"),
                task: asOptionalString(body.task),
                leaseSeconds: 300
            }, { cwd: currentWorkspace });
        case "/api/release-lock":
            return releaseLock({
                roomId: asString(body.roomId, "roomId"),
                chatId: asString(body.chatId, "chatId")
            });
        case "/api/comment":
            return comment({
                roomId: asString(body.roomId, "roomId"),
                chatId: asString(body.chatId, "chatId"),
                body: asString(body.body, "body")
            });
        case "/api/finish-control":
            return finishControl({
                roomId: asString(body.roomId, "roomId"),
                chatId: asString(body.chatId, "chatId"),
                summary: asString(body.summary, "summary"),
                commitMessage: asOptionalString(body.commitMessage),
                commitAndPush: body.commitAndPush !== false,
                declineLocalChanges: Boolean(body.declineLocalChanges),
                sessionPath: asOptionalString(body.sessionPath) || currentSessionPath || undefined,
                allowSensitiveTranscript: Boolean(body.allowSensitiveTranscript)
            }, { cwd: currentWorkspace });
        case "/api/apply-latest":
            return applyLatestHandoff({
                roomId: asString(body.roomId, "roomId"),
                chatId: asString(body.chatId, "chatId"),
                checkout: body.checkout !== false,
                requireCleanTree: body.requireCleanTree !== false
            }, { cwd: currentWorkspace });
        default:
            throw new Error(`Unknown API route ${pathname}`);
    }
}
function applyConfig(body) {
    assignEnv("CHOPSTICKS_SUPABASE_URL", body.supabaseUrl);
    assignEnv("CHOPSTICKS_SUPABASE_ANON_KEY", body.supabaseAnonKey);
    assignEnv("CHOPSTICKS_SUPABASE_ACCESS_TOKEN", body.supabaseAccessToken);
    assignEnv("CHOPSTICKS_STORAGE_BUCKET", body.storageBucket);
    assignEnv("CHOPSTICKS_USER_ID", body.userId);
    assignEnv("CHOPSTICKS_SESSION_PATH", body.sessionPath);
    if (typeof body.workspace === "string" && body.workspace.length > 0) {
        currentWorkspace = body.workspace;
    }
    if (typeof body.sessionPath === "string" && body.sessionPath.length > 0) {
        currentSessionPath = body.sessionPath;
    }
}
async function signInWithPassword(body) {
    const supabaseUrl = asString(body.supabaseUrl, "supabaseUrl").replace(/\/+$/, "");
    const supabaseAnonKey = asString(body.supabaseAnonKey, "supabaseAnonKey");
    const email = asString(body.email, "email");
    const password = asString(body.password, "password");
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
            apikey: supabaseAnonKey,
            "content-type": "application/json"
        },
        body: JSON.stringify({ email, password })
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const message = typeof json.msg === "string"
            ? json.msg
            : typeof json.message === "string"
                ? json.message
                : text;
        throw new Error(`${response.status} ${response.statusText}: ${message}`);
    }
    const accessToken = asString(json.access_token, "access_token");
    const user = json.user;
    if (!user || typeof user !== "object" || Array.isArray(user)) {
        throw new Error("Supabase sign-in did not return a user object");
    }
    const userId = asString(user.id, "user.id");
    applyConfig({
        supabaseUrl,
        supabaseAnonKey,
        supabaseAccessToken: accessToken,
        userId,
        storageBucket: body.storageBucket,
        workspace: body.workspace,
        sessionPath: body.sessionPath
    });
    return {
        ok: true,
        supabaseUrl,
        supabaseAnonKey: redact(supabaseAnonKey),
        supabaseAccessToken: accessToken,
        supabaseAccessTokenPreview: redact(accessToken),
        userId,
        storageBucket: process.env.CHOPSTICKS_STORAGE_BUCKET || "codex-snapshots",
        sessionPath: currentSessionPath || null,
        workspace: currentWorkspace
    };
}
function assignEnv(name, value) {
    if (typeof value === "string" && value.length > 0) {
        process.env[name] = value;
    }
}
function redactedConfig() {
    return {
        supabaseUrl: process.env.CHOPSTICKS_SUPABASE_URL || null,
        supabaseAnonKey: redact(process.env.CHOPSTICKS_SUPABASE_ANON_KEY),
        supabaseAccessToken: redact(process.env.CHOPSTICKS_SUPABASE_ACCESS_TOKEN),
        storageBucket: process.env.CHOPSTICKS_STORAGE_BUCKET || "codex-snapshots",
        userId: process.env.CHOPSTICKS_USER_ID || null,
        sessionPath: currentSessionPath || null,
        workspace: currentWorkspace
    };
}
async function listSessions(search) {
    const limit = Number(search.get("limit") || 20);
    const sessions = await listRecentCodexSessions(undefined, Number.isFinite(limit) ? limit : 20);
    if (!currentSessionPath && sessions.length > 0) {
        currentSessionPath = await latestCodexSession();
    }
    return {
        selectedSessionPath: currentSessionPath || null,
        sessions
    };
}
function redact(value) {
    if (!value)
        return null;
    if (value.length <= 12)
        return "***";
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
async function serveStatic(urlPath, response) {
    const normalized = urlPath === "/" ? "/panel.html" : urlPath;
    const target = path.resolve(appDir, `.${normalized}`);
    if (!target.startsWith(appDir)) {
        sendText(response, 403, "Forbidden", "text/plain");
        return;
    }
    const ext = path.extname(target);
    const contentType = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
    try {
        sendText(response, 200, await readFile(target, "utf8"), contentType);
    }
    catch {
        sendText(response, 404, "Not found", "text/plain");
    }
}
async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
}
function sendJson(response, statusCode, payload) {
    sendText(response, statusCode, JSON.stringify(payload, null, 2), "application/json");
}
function sendText(response, statusCode, text, contentType) {
    response.writeHead(statusCode, {
        "content-type": `${contentType}; charset=utf-8`,
        "cache-control": "no-store"
    });
    response.end(text);
}
function requiredParam(search, name) {
    const value = search.get(name);
    if (!value)
        throw new Error(`Missing query param ${name}`);
    return value;
}
function asString(value, name) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error(`Missing ${name}`);
    return value;
}
function asOptionalString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
