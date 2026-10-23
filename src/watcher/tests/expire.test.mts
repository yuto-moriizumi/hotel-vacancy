// 期限切れ監視削除のユニットテスト（Store を注入・ネットワークなし）
// 実行: node src/watcher/tests/expire.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoreLike, Watch } from "../types.mts";
import { addDaysIso, expiredCutoff, isoDateUtc, purgeExpiredWatches } from "../expire.mts";
import type { Config } from "../config.mts";

test("isoDateUtc / addDaysIso（月末・年またぎ）", () => {
  assert.equal(isoDateUtc(new Date(Date.UTC(2026, 9, 23))), "2026-10-23");
  assert.equal(addDaysIso("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysIso("2027-01-01", -1), "2026-12-31");
  assert.equal(addDaysIso("2026-10-23", -1), "2026-10-22");
});

test("expiredCutoff: 猶予日数だけ now を遡る", () => {
  const now = new Date(Date.UTC(2026, 9, 23));
  assert.equal(expiredCutoff(now, 1), "2026-10-22");
  assert.equal(expiredCutoff(now, 0), "2026-10-23");
  assert.equal(expiredCutoff(now, 7), "2026-10-16");
});

class FakeStore implements StoreLike {
  watches: Watch[] = [];
  deletedCutoff: string | null = null;
  async addWatch(): Promise<number> {
    throw new Error("unused");
  }
  async listWatches(): Promise<Watch[]> {
    return this.watches.filter((w) => w.active);
  }
  async getWatch(): Promise<Watch | undefined> {
    return undefined;
  }
  async setActive(): Promise<void> {}
  async recordCheck(): Promise<void> {}
  async lastGoodVacant(): Promise<number | null> {
    return null;
  }
  async consecutiveErrors(): Promise<number> {
    return 0;
  }
  async insertNotification(): Promise<void> {}
  async hasRecentVacancyNotification(): Promise<boolean> {
    return false;
  }
  async deleteWatch(): Promise<void> {}
  /** 実DB同様: 終了日=checkin_date+nights <= cutoff を削除 */
  async deleteExpired(cutoff: string): Promise<number[]> {
    this.deletedCutoff = cutoff;
    const ids: number[] = [];
    this.watches = this.watches.filter((w) => {
      const end = addDaysIso(w.checkin_date, w.nights);
      if (end <= cutoff) {
        ids.push(w.id);
        return false;
      }
      return true;
    });
    return ids;
  }
  async latestCheckByWatch(): Promise<
    { watchId: number; checkedAt: string; route: string | null; totalVacant: number | null; lowestPrice: number | null; error: string | null }[]
  > {
    return [];
  }
  close(): void {}
}

function mkWatch(id: number, checkin_date: string, nights: number, active = true): Watch {
  return {
    id,
    hotel_code: "00270",
    hotel_name: null,
    checkin_date,
    nights,
    rooms: 1,
    people: 1,
    smoking: "all",
    notify_to: null,
    active,
    created_at: "",
  };
}

const cfg: Config = {
  dbUrl: "postgres://x",
  smtp: { host: "", port: 465, user: "", pass: "", from: "", secure: true },
  stopAfterNotify: false,
  delayMinMs: 0,
  delayMaxMs: 0,
  maxConsecutiveFailures: 3,
  refireWindowMinutes: 360,
  expireGraceDays: 1,
};

const logs: string[] = [];

test("宿泊終了日を過ぎた監視（active/inactive両方）だけが削除される", async () => {
  const s = new FakeStore();
  // now=2026-10-23, grace=1 → cutoff=2026-10-22
  const now = new Date(Date.UTC(2026, 9, 23));
  s.watches = [
    mkWatch(1, "2026-10-21", 1), // 終了=10-22 → 削除
    mkWatch(2, "2026-10-22", 1), // 終了=10-23 → 残る（猶予1日）
    mkWatch(3, "2026-10-20", 2, false), // 終了=10-22 → 削除（active=false も対象）
    mkWatch(4, "2026-10-30", 1), // 未来 → 残る
  ];
  const ids = await purgeExpiredWatches({ store: s, config: cfg, log: (m) => logs.push(m), now });
  assert.deepEqual(ids, [1, 3]);
  assert.equal(s.deletedCutoff, "2026-10-22");
  assert.deepEqual(s.watches.map((w) => w.id), [2, 4]);
  const id1Log = logs.find((l) => l.includes("watch#1"));
  assert.ok(id1Log?.includes("cutoff=2026-10-22"));
});
