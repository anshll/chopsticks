const state = {
  rooms: [],
  chats: [],
  selectedRoomId: localStorage.getItem("chopsticks.roomId"),
  selectedChatId: localStorage.getItem("chopsticks.chatId"),
  status: null,
  configSynced: false
};

const el = {
  connectionStatus: document.querySelector("#connectionStatus"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseAnonKey: document.querySelector("#supabaseAnonKey"),
  supabaseAccessToken: document.querySelector("#supabaseAccessToken"),
  userId: document.querySelector("#userId"),
  storageBucket: document.querySelector("#storageBucket"),
  workspace: document.querySelector("#workspace"),
  sessionPath: document.querySelector("#sessionPath"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  roomName: document.querySelector("#roomName"),
  repoUrl: document.querySelector("#repoUrl"),
  roomsList: document.querySelector("#roomsList"),
  activeRoomName: document.querySelector("#activeRoomName"),
  chatsList: document.querySelector("#chatsList"),
  handoffSummary: document.querySelector("#handoffSummary"),
  handoffBranch: document.querySelector("#handoffBranch"),
  handoffCommit: document.querySelector("#handoffCommit"),
  handoffTranscript: document.querySelector("#handoffTranscript"),
  finishSummary: document.querySelector("#finishSummary"),
  commitMessage: document.querySelector("#commitMessage"),
  commitAndPush: document.querySelector("#commitAndPush"),
  declineLocalChanges: document.querySelector("#declineLocalChanges"),
  allowSensitiveTranscript: document.querySelector("#allowSensitiveTranscript"),
  output: document.querySelector("#output")
};

loadConfigForm();

document.querySelector("#saveConfig")?.addEventListener("click", async () => {
  await runAction(async () => {
    saveConfigForm();
    state.configSynced = false;
    await syncConfig();
    await refresh();
    writeOutput("Config saved.");
  });
});

document.querySelector("#clearConfig")?.addEventListener("click", () => {
  localStorage.removeItem("chopsticks.config");
  for (const input of [el.supabaseUrl, el.supabaseAnonKey, el.supabaseAccessToken, el.userId, el.storageBucket, el.workspace]) {
    input.value = "";
  }
  el.sessionPath.replaceChildren();
  state.configSynced = false;
  writeOutput("Local setup fields cleared. Restart the sidecar to clear server memory.");
});

document.querySelector("#signInSupabase")?.addEventListener("click", async () => {
  saveConfigForm();
  const config = readConfigForm();
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!config.supabaseUrl || !config.supabaseAnonKey) return writeOutput("Supabase URL and publishable key are required.");
  if (!email || !password) return writeOutput("Email and password are required.");
  const button = document.querySelector("#signInSupabase");
  button.disabled = true;
  try {
    const result = await api("/api/auth/sign-in", {
      ...config,
      email,
      password
    });
    el.supabaseAccessToken.value = result.supabaseAccessToken || "";
    el.userId.value = result.userId || "";
    if (!el.supabaseAccessToken.value) {
      throw new Error("Sign-in succeeded, but no access token was returned to the panel.");
    }
    saveConfigForm();
    state.configSynced = true;
    el.authPassword.value = "";
    writeOutput(`Signed in as ${result.userId}. Config saved.`);
    await refresh();
  } catch (error) {
    state.configSynced = false;
    writeOutput(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#createRoom")?.addEventListener("click", async () => {
  await runAction(async () => {
    const name = el.roomName.value.trim();
    const repoUrl = el.repoUrl.value.trim();
    if (!name || !repoUrl) return writeOutput("Room name and GitHub URL are required.");
    await syncConfig();
    const result = await api("/api/rooms", { name, repoUrl });
    state.selectedRoomId = result.room.id;
    state.selectedChatId = result.chat.id;
    persistSelection();
    writeOutput(`Created room "${result.room.name}".`);
    await refresh();
  });
});

document.querySelector("#createChat")?.addEventListener("click", async () => {
  await runAction(async () => {
    if (!state.selectedRoomId) return writeOutput("Select a room first.");
    const title = prompt("Chat title", "Shared Codex chat");
    if (!title) return;
    await syncConfig();
    const chat = await api("/api/chats", { roomId: state.selectedRoomId, title });
    state.selectedChatId = chat.id;
    persistSelection();
    await refresh();
  });
});

document.querySelector("#finishControl")?.addEventListener("click", async () => {
  await runAction(async () => {
    if (!state.selectedRoomId || !state.selectedChatId) return writeOutput("Select a chat first.");
    const summary = el.finishSummary.value.trim();
    if (!summary && !el.declineLocalChanges.checked) return writeOutput("Add a handoff summary first.");
    await syncConfig();
    const result = await api("/api/finish-control", {
      roomId: state.selectedRoomId,
      chatId: state.selectedChatId,
      summary: summary || "Released control without accepting local changes",
      commitMessage: el.commitMessage.value.trim() || summary,
      commitAndPush: el.commitAndPush.checked,
      declineLocalChanges: el.declineLocalChanges.checked,
      sessionPath: el.sessionPath.value,
      allowSensitiveTranscript: el.allowSensitiveTranscript.checked
    });
    writeOutput(JSON.stringify(result, null, 2));
    await refresh();
  });
});

document.querySelector("#applyHandoff")?.addEventListener("click", async () => {
  await runAction(async () => {
    if (!state.selectedRoomId || !state.selectedChatId) return writeOutput("Select a chat first.");
    await syncConfig();
    const result = await api("/api/apply-latest", {
      roomId: state.selectedRoomId,
      chatId: state.selectedChatId,
      checkout: true,
      requireCleanTree: true,
      targetSessionPath: el.sessionPath.value
    });
    writeOutput(JSON.stringify(result, null, 2));
    await refresh();
  });
});

document.querySelector("#releaseLock")?.addEventListener("click", async () => {
  await runAction(async () => {
    if (!state.selectedRoomId || !state.selectedChatId) return writeOutput("Select a chat first.");
    await syncConfig();
    const result = await api("/api/release-lock", {
      roomId: state.selectedRoomId,
      chatId: state.selectedChatId
    });
    writeOutput(JSON.stringify(result, null, 2));
    await refresh();
  });
});

async function refresh() {
  try {
    await refreshSessions();
    await syncConfig();
    await api("/api/health", null, "GET");
    el.connectionStatus.textContent = "Connected to local sidecar";
    const rooms = await api("/api/rooms", null, "GET");
    state.rooms = rooms.rooms || [];
    if (!state.selectedRoomId && state.rooms[0]) state.selectedRoomId = state.rooms[0].id;
    await refreshChats();
    await refreshStatus();
    render();
  } catch (error) {
    el.connectionStatus.textContent = location.protocol === "file:"
      ? "Open this panel from the local sidecar, not file://"
      : "Connected to panel server; configure Supabase auth to load rooms";
    writeOutput(error.message);
  }
}

async function refreshSessions() {
  const saved = JSON.parse(localStorage.getItem("chopsticks.config") || "{}");
  const current = el.sessionPath.value || saved.sessionPath || "";
  const result = await api("/api/sessions?limit=20", null, "GET");
  const sessions = result.sessions || [];
  el.sessionPath.replaceChildren(...sessions.map(session => {
    const option = document.createElement("option");
    option.value = session.path;
    option.textContent = sessionLabel(session);
    return option;
  }));
  const selected = current || result.selectedSessionPath || sessions[0]?.path || "";
  if (selected) el.sessionPath.value = selected;
  saveConfigForm();
}

async function syncConfig() {
  if (state.configSynced) return;
  const config = readConfigForm();
  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.supabaseAccessToken || !config.userId) {
    throw new Error("Fill Supabase setup and click Save Config.");
  }
  await api("/api/config", config);
  state.configSynced = true;
}

async function refreshChats() {
  state.chats = [];
  if (!state.selectedRoomId) return;
  const chats = await api(`/api/chats?roomId=${encodeURIComponent(state.selectedRoomId)}`, null, "GET");
  state.chats = chats.chats || [];
  if (!state.selectedChatId && state.chats[0]) state.selectedChatId = state.chats[0].id;
}

async function refreshStatus() {
  state.status = null;
  if (!state.selectedRoomId || !state.selectedChatId) return;
  state.status = await api(`/api/status?roomId=${encodeURIComponent(state.selectedRoomId)}&chatId=${encodeURIComponent(state.selectedChatId)}`, null, "GET");
}

function render() {
  persistSelection();
  const activeRoom = state.rooms.find(room => room.id === state.selectedRoomId);
  el.activeRoomName.textContent = activeRoom ? activeRoom.name : "No room selected";
  renderRooms();
  renderChats();
  renderHandoff();
}

function renderRooms() {
  el.roomsList.replaceChildren(...state.rooms.map(room => {
    const button = document.createElement("button");
    button.className = `room ${room.id === state.selectedRoomId ? "active" : ""}`;
    button.innerHTML = `<span>${escapeHtml(room.name)}</span><small>${escapeHtml(room.repo_url)}</small>`;
    button.addEventListener("click", async () => {
      state.selectedRoomId = room.id;
      state.selectedChatId = null;
      await refresh();
    });
    return button;
  }));
}

function renderChats() {
  el.chatsList.replaceChildren(...state.chats.map(chat => {
    const isSelected = chat.id === state.selectedChatId;
    const lock = isSelected ? state.status?.lock : null;
    const latest = isSelected ? state.status?.latestHandoff : null;
    const locked = lock?.owner_user_id && lock?.lease_expires_at && new Date(lock.lease_expires_at) > new Date();
    const row = document.createElement("div");
    row.className = `chat-row ${isSelected ? "selected" : ""} ${locked ? "locked" : "ready"}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(chat.title)}</strong>
        <p>${locked ? `Locked until ${new Date(lock.lease_expires_at).toLocaleTimeString()}` : latest ? "Latest handoff is ready." : "Ready for control."}</p>
      </div>
      <div class="actions">
        <span class="badge">${locked ? "Locked" : "Ready"}</span>
        <button class="primary" data-action="take">Take Control</button>
        <button data-action="comment">Comment</button>
      </div>
    `;
    row.addEventListener("click", async event => {
      await runAction(async () => {
        const action = event.target?.dataset?.action;
        state.selectedChatId = chat.id;
        persistSelection();
        if (action === "take") {
          await syncConfig();
          const result = await api("/api/acquire-lock", {
            roomId: state.selectedRoomId,
            chatId: chat.id,
            task: chat.title
          });
          writeOutput(JSON.stringify(result, null, 2));
        } else if (action === "comment") {
          const body = prompt("Comment");
          if (body) {
            await syncConfig();
            const result = await api("/api/comment", { roomId: state.selectedRoomId, chatId: chat.id, body });
            writeOutput(JSON.stringify(result, null, 2));
          }
        }
        await refresh();
      });
    });
    return row;
  }));
}

function renderHandoff() {
  const handoff = state.status?.latestHandoff;
  el.handoffSummary.textContent = handoff?.summary || "No handoff yet";
  el.handoffBranch.textContent = handoff?.git_ref || "-";
  el.handoffCommit.textContent = handoff?.git_commit || "-";
  el.handoffTranscript.textContent = handoff ? "Synced" : "-";
}

async function api(path, body, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  const json = await response.json();
  if (!response.ok || json.ok === false) throw new Error(JSON.stringify(json, null, 2));
  return json;
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    writeOutput(formatError(error));
  }
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);
  try {
    const parsed = JSON.parse(error.message);
    return parsed.error || JSON.stringify(parsed, null, 2);
  } catch {
    return error.message;
  }
}

function persistSelection() {
  if (state.selectedRoomId) localStorage.setItem("chopsticks.roomId", state.selectedRoomId);
  if (state.selectedChatId) localStorage.setItem("chopsticks.chatId", state.selectedChatId);
}

function loadConfigForm() {
  const saved = JSON.parse(localStorage.getItem("chopsticks.config") || "{}");
  el.supabaseUrl.value = saved.supabaseUrl || "https://brzavzswidmkaxpklgah.supabase.co";
  el.supabaseAnonKey.value = saved.supabaseAnonKey || "sb_publishable_UcXodE6UsuIHq2T6TIZ7aA_qAadjbIi";
  el.supabaseAccessToken.value = saved.supabaseAccessToken || "";
  el.userId.value = saved.userId || "";
  el.storageBucket.value = saved.storageBucket || "codex-snapshots";
  el.workspace.value = saved.workspace || "";
  if (saved.sessionPath) {
    const option = document.createElement("option");
    option.value = saved.sessionPath;
    option.textContent = saved.sessionPath;
    el.sessionPath.replaceChildren(option);
    el.sessionPath.value = saved.sessionPath;
  }
  el.authEmail.value = saved.authEmail || "";
}

function readConfigForm() {
  return {
    supabaseUrl: el.supabaseUrl.value.trim(),
    supabaseAnonKey: el.supabaseAnonKey.value.trim(),
    supabaseAccessToken: el.supabaseAccessToken.value.trim(),
    userId: el.userId.value.trim(),
    storageBucket: el.storageBucket.value.trim() || "codex-snapshots",
    workspace: el.workspace.value.trim(),
    sessionPath: el.sessionPath.value,
    authEmail: el.authEmail.value.trim()
  };
}

function saveConfigForm() {
  localStorage.setItem("chopsticks.config", JSON.stringify(readConfigForm()));
}

function writeOutput(text) {
  el.output.textContent = text;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function sessionLabel(session) {
  const modified = session.modifiedAt ? new Date(session.modifiedAt).toLocaleString() : "unknown time";
  const cwd = session.cwd || "unknown cwd";
  return `${modified} - ${cwd}`;
}

void refresh();
setInterval(refresh, 15000);
