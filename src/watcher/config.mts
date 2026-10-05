// 設定（.env.local を素朴に読む。Nodeの --env-file は値のクォート除去が環境依存のため自前実装）
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SmokingFilter } from "./types.mts";

const SMOKING: Record<string, SmokingFilter> = { all: "all", no_smoking: "no_smoking", smoking: "smoking" };
export function parseSmoking(s: string | undefined): SmokingFilter {
  return SMOKING[(s ?? "all").trim().toLowerCase()] ?? "all";
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    //  Surrounding quotes を除去（"..." or '...'）
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ""); // inline comment
    out[m[1]] = v;
  }
  return out;
}

export interface SmtpCfg {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}
export interface Config {
  dbUrl: string;
  smtp: SmtpCfg;
  /** 通知後 active=false で停止（元サイト仕様の踏襲） */
  stopAfterNotify: boolean;
  /** 監視間の sleep (ms) */
  delayMinMs: number;
  delayMaxMs: number;
  /** 連続失敗で停止＋管理者通知する閾値 */
  maxConsecutiveFailures: number;
  /** 再通知の最小間隔（分） */
  refireWindowMinutes: number;
}

export function loadConfig(cwd = process.cwd()): Config {
  let file: Record<string, string> = {};
  for (const name of [".env.local", ".env"]) {
    try {
      // 動的パスは意図的（ローカル開発用の .env 読み込み）。Vercel では process.env を使用。
      file = { ...parseEnvFile(readFileSync(/* turbopackIgnore: true */ resolve(cwd, name), "utf8")), ...file };
    } catch {
      /* missing */
    }
  }
  const get = (k: string) => process.env[k] ?? file[k];
  const bool = (k: string, d: boolean) => {
    const v = get(k);
    return v == null || v === "" ? d : v === "1" || v.toLowerCase() === "true";
  };
  const num = (k: string, d: number) => {
    const v = get(k);
    const n = v == null || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const dbUrl = get("DATABASE_URL");
  if (!dbUrl) throw new Error("DATABASE_URL is not set (.env.local)");
  return {
    dbUrl,
    smtp: {
      host: get("SMTP_HOST") ?? "",
      port: num("SMTP_PORT", 465),
      user: get("SMTP_USER") ?? "",
      pass: get("SMTP_PASS") ?? "",
      from: get("SMTP_FROM") ?? get("SMTP_USER") ?? "",
      secure: bool("SMTP_SECURE", num("SMTP_PORT", 465) === 465),
    },
    stopAfterNotify: bool("TOYOKO_STOP_AFTER_NOTIFY", false),
    delayMinMs: num("TOYOKO_DELAY_MIN_MS", 3000),
    delayMaxMs: num("TOYOKO_DELAY_MAX_MS", 10000),
    maxConsecutiveFailures: num("TOYOKO_MAX_FAILURES", 3),
    refireWindowMinutes: num("TOYOKO_REFIRE_MIN", 360),
  };
}
