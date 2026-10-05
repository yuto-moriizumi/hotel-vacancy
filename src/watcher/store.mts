// Postgres(Neon)-backed store over a minimal Db abstraction.
import type { StoreLike, Watch, NewWatch, NotifyKind, Route } from "./types.mts";
import { neon } from "@neondatabase/serverless";

/** neon() HTTP クライアントの薄いラッパ（1リクエスト=1ステートメント） */
export interface Db {
  query(text: string, params?: unknown[]): Promise<any[]>;
}

export function makeNeonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    query: (text, params) => sql.query(text, params ?? []),
  };
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS watches (
     id SERIAL PRIMARY KEY,
     hotel_code TEXT NOT NULL,
     hotel_name TEXT,
     checkin_date TEXT NOT NULL,
     nights INT NOT NULL,
     rooms INT NOT NULL DEFAULT 1,
     people INT NOT NULL DEFAULT 1,
     smoking TEXT NOT NULL DEFAULT 'all',
     notify_to TEXT,
     active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );`,
  // 既存テーブルへのマイグレーション（冪等）
  `ALTER TABLE watches ADD COLUMN IF NOT EXISTS notify_to TEXT;`,
  `CREATE TABLE IF NOT EXISTS checks (
     id SERIAL PRIMARY KEY,
     watch_id INT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
     checked_at TIMESTAMPTZ NOT NULL,
     http_status INT,
     route TEXT,
     total_vacant INT,
     lowest_price INT,
     plans_json TEXT,
     error TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_checks_watch ON checks(watch_id, id DESC);`,
  `CREATE TABLE IF NOT EXISTS notifications (
     id SERIAL PRIMARY KEY,
     watch_id INT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
     sent_at TIMESTAMPTZ NOT NULL,
     kind TEXT NOT NULL,
     body TEXT
   );`,
];

/** neon が返す timestamptz を ISO 文字列に正規化 */
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

export class Store implements StoreLike {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  /** 起動時に一度だけ呼ぶ（スキーマ確保）。DDLは1ステートメントずつ順次実行 */
  async init(): Promise<void> {
    for (const ddl of SCHEMA) await this.db.query(ddl);
  }

  async addWatch(w: NewWatch): Promise<number> {
    const r = await this.db.query(
      `INSERT INTO watches(hotel_code, hotel_name, checkin_date, nights, rooms, people, smoking, notify_to, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        w.hotel_code,
        w.hotel_name ?? null,
        w.checkin_date,
        w.nights,
        w.rooms,
        w.people,
        w.smoking,
        w.notify_to ?? null,
        w.active ?? true,
      ],
    );
    return Number(r[0].id);
  }

  async listWatches(onlyActive = false): Promise<Watch[]> {
    const where = onlyActive ? `WHERE active = TRUE` : ``;
    const rows = await this.db.query(`SELECT * FROM watches ${where} ORDER BY id`);
    return rows.map((r) => this.rowToWatch(r));
  }

  async getWatch(id: number): Promise<Watch | undefined> {
    const rows = await this.db.query(`SELECT * FROM watches WHERE id=$1`, [id]);
    return rows.length ? this.rowToWatch(rows[0]) : undefined;
  }

  private rowToWatch(r: any): Watch {
    return {
      id: Number(r.id),
      hotel_code: r.hotel_code,
      hotel_name: r.hotel_name ?? null,
      checkin_date: r.checkin_date,
      nights: Number(r.nights),
      rooms: Number(r.rooms),
      people: Number(r.people),
      smoking: r.smoking,
      notify_to: r.notify_to ?? null,
      active: Boolean(r.active),
      created_at: toIso(r.created_at),
    };
  }

  async setActive(id: number, active: boolean): Promise<void> {
    await this.db.query(`UPDATE watches SET active=$1 WHERE id=$2`, [active, id]);
  }

  async recordCheck(input: {
    watchId: number;
    checkedAt: string;
    httpStatus: number | null;
    route: Route | null;
    totalVacant: number | null;
    lowestPrice: number | null;
    plansJson: string | null;
    error: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO checks(watch_id, checked_at, http_status, route, total_vacant, lowest_price, plans_json, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.watchId,
        input.checkedAt,
        input.httpStatus,
        input.route,
        input.totalVacant,
        input.lowestPrice,
        input.plansJson,
        input.error,
      ],
    );
  }

  async lastGoodVacant(watchId: number): Promise<number | null> {
    const rows = await this.db.query(
      `SELECT total_vacant FROM checks WHERE watch_id=$1 AND error IS NULL ORDER BY id DESC LIMIT 1`,
      [watchId],
    );
    return rows.length ? numOrNull(rows[0].total_vacant) : null;
  }

  async consecutiveErrors(watchId: number): Promise<number> {
    const rows = await this.db.query(`SELECT error FROM checks WHERE watch_id=$1 ORDER BY id DESC LIMIT 20`, [watchId]);
    let n = 0;
    for (const r of rows) {
      if (r.error != null) n++;
      else break;
    }
    return n;
  }

  async insertNotification(input: { watchId: number; sentAt: string; kind: NotifyKind; body: string }): Promise<void> {
    await this.db.query(`INSERT INTO notifications(watch_id, sent_at, kind, body) VALUES ($1,$2,$3,$4)`, [
      input.watchId,
      input.sentAt,
      input.kind,
      input.body,
    ]);
  }

  async hasRecentVacancyNotification(watchId: number, minutes: number): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 FROM notifications WHERE watch_id=$1 AND kind='vacancy' AND sent_at > (now() - make_interval(mins => $2::int)) LIMIT 1`,
      [watchId, minutes],
    );
    return rows.length > 0;
  }

  async deleteWatch(id: number): Promise<void> {
    await this.db.query(`DELETE FROM watches WHERE id=$1`, [id]);
  }

  async latestCheckByWatch(): Promise<
    { watchId: number; checkedAt: string; route: string | null; totalVacant: number | null; lowestPrice: number | null; error: string | null }[]
  > {
    const rows = await this.db.query(
      `SELECT DISTINCT ON (watch_id) watch_id, checked_at, route, total_vacant, lowest_price, error
       FROM checks ORDER BY watch_id, id DESC`,
    );
    return rows.map((r) => ({
      watchId: Number(r.watch_id),
      checkedAt: toIso(r.checked_at),
      route: r.route ?? null,
      totalVacant: numOrNull(r.total_vacant),
      lowestPrice: numOrNull(r.lowest_price),
      error: r.error ?? null,
    }));
  }

  close(): void {
    /* HTTP mode is stateless; nothing to close */
  }
}
