export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface ChopsticksConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseAccessToken: string;
  storageBucket: string;
  userId: string;
  pluginVersion: string;
}

export interface Handoff {
  id: string;
  room_id: string;
  chat_id: string;
  created_by: string;
  summary: string | null;
  snapshot_storage_path: string;
  snapshot_sha256: string;
  git_repo_url: string | null;
  git_ref: string | null;
  git_commit: string | null;
  codex_version: string | null;
  plugin_version: string | null;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
  repo_url: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  room_id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LockRow {
  room_id: string;
  chat_id: string;
  owner_user_id: string | null;
  task: string | null;
  base_git_ref: string | null;
  base_git_commit: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

export interface SnapshotMetadata {
  schema_version: "1.0";
  room_id: string;
  chat_id: string;
  handoff_id: string;
  created_by: string;
  created_at: string;
  git: {
    repo_url: string | null;
    ref: string | null;
    commit: string | null;
  };
  codex: {
    version: string | null;
    session_id: string | null;
    original_cwd: string;
  };
  snapshot: {
    storage_path: string;
    sha256: string;
  };
}
