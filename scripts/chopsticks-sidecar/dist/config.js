import { randomUUID } from "node:crypto";
export function loadConfig() {
    const supabaseUrl = requiredEnv("CHOPSTICKS_SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("CHOPSTICKS_SUPABASE_ANON_KEY");
    const supabaseAccessToken = process.env.CHOPSTICKS_SUPABASE_ACCESS_TOKEN || supabaseAnonKey;
    return {
        supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
        supabaseAnonKey,
        supabaseAccessToken,
        storageBucket: process.env.CHOPSTICKS_STORAGE_BUCKET || "codex-snapshots",
        userId: process.env.CHOPSTICKS_USER_ID || randomUUID(),
        pluginVersion: "0.1.0"
    };
}
function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable ${name}`);
    }
    return value;
}
