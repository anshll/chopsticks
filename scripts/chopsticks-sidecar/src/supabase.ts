import type { Chat, ChopsticksConfig, Handoff, Json, LockRow, Room } from "./types.js";

export class SupabaseRest {
  constructor(private readonly config: ChopsticksConfig) {}

  async getStatus(roomId: string, chatId: string): Promise<{ lock: LockRow | null; latestHandoff: Handoff | null }> {
    const [locks, handoffs] = await Promise.all([
      this.select<LockRow>("room_locks", { room_id: `eq.${roomId}`, chat_id: `eq.${chatId}`, limit: "1" }),
      this.select<Handoff>("handoffs", {
        room_id: `eq.${roomId}`,
        chat_id: `eq.${chatId}`,
        order: "created_at.desc",
        limit: "1"
      })
    ]);
    return { lock: locks[0] || null, latestHandoff: handoffs[0] || null };
  }

  async listRooms(): Promise<Room[]> {
    return await this.select<Room>("rooms", { order: "updated_at.desc" });
  }

  async listChats(roomId: string): Promise<Chat[]> {
    return await this.select<Chat>("chats", {
      room_id: `eq.${roomId}`,
      order: "updated_at.desc"
    });
  }

  async createRoom(input: { name: string; repoUrl: string }): Promise<{ room: Room; chat: Chat }> {
    const rooms = await this.insert<Room>("rooms", {
      name: input.name,
      repo_url: input.repoUrl,
      created_by: this.config.userId
    });
    const room = rooms[0];
    await this.insert("room_members", {
      room_id: room.id,
      user_id: this.config.userId,
      role: "owner"
    });
    const chats = await this.insert<Chat>("chats", {
      room_id: room.id,
      title: "Shared Codex chat",
      created_by: this.config.userId
    });
    await this.insert("room_events", {
      room_id: room.id,
      chat_id: chats[0].id,
      type: "room.created",
      payload: { repo_url: input.repoUrl },
      created_by: this.config.userId
    });
    return { room, chat: chats[0] };
  }

  async createChat(input: { roomId: string; title: string }): Promise<Chat> {
    const chats = await this.insert<Chat>("chats", {
      room_id: input.roomId,
      title: input.title,
      created_by: this.config.userId
    });
    await this.insert("room_events", {
      room_id: input.roomId,
      chat_id: chats[0].id,
      type: "chat.created",
      payload: { title: input.title },
      created_by: this.config.userId
    });
    return chats[0];
  }

  async acquireLock(input: {
    roomId: string;
    chatId: string;
    task: string | null;
    baseGitRef: string | null;
    baseGitCommit: string | null;
    leaseSeconds: number;
  }): Promise<LockRow> {
    const leaseExpiresAt = new Date(Date.now() + input.leaseSeconds * 1000).toISOString();
    const rows = await this.rpc<LockRow>("acquire_chat_lock", {
      p_room_id: input.roomId,
      p_chat_id: input.chatId,
      p_owner_user_id: this.config.userId,
      p_task: input.task,
      p_base_git_ref: input.baseGitRef,
      p_base_git_commit: input.baseGitCommit,
      p_lease_expires_at: leaseExpiresAt
    });
    return rows[0];
  }

  async renewLock(roomId: string, chatId: string, leaseSeconds: number): Promise<LockRow> {
    const rows = await this.rpc<LockRow>("renew_chat_lock", {
      p_room_id: roomId,
      p_chat_id: chatId,
      p_owner_user_id: this.config.userId,
      p_lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString()
    });
    return rows[0];
  }

  async releaseLock(roomId: string, chatId: string): Promise<void> {
    await this.rpc<Json>("release_chat_lock", {
      p_room_id: roomId,
      p_chat_id: chatId,
      p_owner_user_id: this.config.userId
    });
  }

  async createHandoff(row: Handoff): Promise<Handoff> {
    const rows = await this.insert<Handoff>("handoffs", row);
    await this.insert("room_events", {
      room_id: row.room_id,
      chat_id: row.chat_id,
      type: "handoff.created",
      payload: { handoff_id: rows[0].id, git_commit: row.git_commit },
      created_by: this.config.userId
    });
    return rows[0];
  }

  async createMessage(roomId: string, chatId: string, body: string): Promise<Json> {
    const message = await this.insert("messages", {
      room_id: roomId,
      chat_id: chatId,
      sender_id: this.config.userId,
      body
    });
    await this.insert("room_events", {
      room_id: roomId,
      chat_id: chatId,
      type: "message.created",
      payload: { body },
      created_by: this.config.userId
    });
    return message[0] as Json;
  }

  async uploadObject(path: string, bytes: Buffer, contentType = "application/jsonl"): Promise<void> {
    const url = `${this.config.supabaseUrl}/storage/v1/object/${this.config.storageBucket}/${path}`;
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers({ "content-type": contentType, "x-upsert": "false" }),
      body
    });
    await ensureOk(response);
  }

  async downloadObject(path: string): Promise<Buffer> {
    const url = `${this.config.supabaseUrl}/storage/v1/object/${this.config.storageBucket}/${path}`;
    const response = await fetch(url, { headers: this.headers() });
    await ensureOk(response);
    return Buffer.from(await response.arrayBuffer());
  }

  private async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
    const params = new URLSearchParams(query);
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${table}?${params}`, {
      headers: this.headers({ accept: "application/json" })
    });
    await ensureOk(response);
    return await response.json() as T[];
  }

  private async insert<T = Json>(table: string, row: unknown): Promise<T[]> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        prefer: "return=representation"
      }),
      body: JSON.stringify(row)
    });
    await ensureOk(response);
    return await response.json() as T[];
  }

  private async rpc<T>(name: string, body: unknown): Promise<T[]> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        prefer: "return=representation"
      }),
      body: JSON.stringify(body)
    });
    await ensureOk(response);
    const text = await response.text();
    return text ? JSON.parse(text) as T[] : [];
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.config.supabaseAnonKey,
      authorization: `Bearer ${this.config.supabaseAccessToken}`,
      ...extra
    };
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
}
