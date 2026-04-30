#!/usr/bin/env node
import { acquireLock, applyLatestHandoff, comment, createChat, createHandoff, createRoom, finishControl, listChats, listRooms, releaseLock, renewLock, status } from "./core.js";

const [, , command, ...rest] = process.argv;

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const args = parseArgs(rest);
  const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
  const result = await dispatch(command, args, cwd);
  console.log(JSON.stringify(result, null, 2));
}

async function dispatch(commandName: string | undefined, args: Record<string, string | boolean>, cwd: string) {
  switch (commandName) {
    case "list-rooms":
      return listRooms();
    case "list-chats":
      return listChats({ roomId: requiredString(args.roomId, "room-id") });
    case "create-room":
      return createRoom({
        name: requiredString(args.name, "name"),
        repoUrl: requiredString(args.repoUrl, "repo-url")
      });
    case "create-chat":
      return createChat({
        roomId: requiredString(args.roomId, "room-id"),
        title: stringArg(args.title)
      });
    case "status":
      return status(requiredRoomChat(args));
    case "acquire-lock":
      return acquireLock({ ...requiredRoomChat(args), task: stringArg(args.task), leaseSeconds: numberArg(args.leaseSeconds) }, { cwd });
    case "renew-lock":
      return renewLock({ ...requiredRoomChat(args), leaseSeconds: numberArg(args.leaseSeconds) });
    case "release-lock":
      return releaseLock(requiredRoomChat(args));
    case "comment":
      return comment({ ...requiredRoomChat(args), body: requiredString(args.body, "body") });
    case "create-handoff":
      return createHandoff({
        ...requiredRoomChat(args),
        summary: requiredString(args.summary, "summary"),
        sessionPath: stringArg(args.sessionPath),
        codexVersion: stringArg(args.codexVersion),
        allowSensitiveTranscript: Boolean(args.allowSensitiveTranscript)
      }, { cwd });
    case "finish-control":
      return finishControl({
        ...requiredRoomChat(args),
        summary: requiredString(args.summary, "summary"),
        commitMessage: stringArg(args.commitMessage),
        commitAndPush: Boolean(args.commitAndPush),
        declineLocalChanges: Boolean(args.declineLocalChanges),
        sessionPath: stringArg(args.sessionPath),
        codexVersion: stringArg(args.codexVersion),
        allowSensitiveTranscript: Boolean(args.allowSensitiveTranscript)
      }, { cwd });
    case "apply-latest":
      return applyLatestHandoff({
        ...requiredRoomChat(args),
        checkout: args.checkout !== false,
        requireCleanTree: args.requireCleanTree !== false
      }, { cwd });
    default:
      return {
        usage: [
          "chopsticks create-room --name <name> --repo-url <github-url>",
          "chopsticks create-chat --room-id <uuid> --title <title>",
          "chopsticks finish-control --room-id <uuid> --chat-id <uuid> --summary <text> --commit-and-push",
          "chopsticks status --room-id <uuid> --chat-id <uuid>",
          "chopsticks acquire-lock --room-id <uuid> --chat-id <uuid> --task <text>",
          "chopsticks create-handoff --room-id <uuid> --chat-id <uuid> --summary <text>",
          "chopsticks apply-latest --room-id <uuid> --chat-id <uuid>"
        ]
      };
  }
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function requiredRoomChat(args: Record<string, string | boolean>) {
  return {
    roomId: requiredString(args.roomId, "room-id"),
    chatId: requiredString(args.chatId, "chat-id")
  };
}

function requiredString(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function stringArg(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number ${value}`);
  return parsed;
}
