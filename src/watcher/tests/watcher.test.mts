// エッジ検知・通知ポリシーのユニットテスト（Store/check を注入・ネットワークなし）
// 実行: node src/watcher/tests/watcher.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoreLike, Watch, CheckOutcome, NotifyKind, Route } from "../types.mts";
import { checkWatchOnce } from "../watcher.mts";
import type { Config } from "../config.mts";

class FakeStore implements StoreLike {
  checks: { watchId: number; totalVacant: number | null; error: string | null }[] = [];
  notes: { watchId: number; kind: NotifyKind }[] = [];
  actives = new Map<number, boolean>();
  private recentNotify = false;
  setRecentNotify(v: boolean) {
    this.recentNotify = v;
  }
  async addWatch(): Promise<number> {
    return 1;
  }
  async listWatches(): Promise<Watch[]> {
    return [];
  }
  async getWatch(): Promise<Watch | undefined> {
    return undefined;
  }
  async setActive(id: number, active: boolean): Promise<void> {
    this.actives.set(id, active);
  }
  async recordCheck(i: { watchId: number; totalVacant: number | null; error: string | null }): Promise<void> {
    this.checks.push(i);
  }
  async lastGoodVacant(): Promise<number | null> {
    for (let i = this.checks.length - 1; i >= 0; i--) if (!this.checks[i].error) return this.checks[i].totalVacant;
    return null;
  }
  async consecutiveErrors(): Promise<number> {
    let n = 0;
    for (let i = this.checks.length - 1; i >= 0; i--) {
      if (this.checks[i].error) n++;
      else break;
    }
    return n;
  }
  async insertNotification(i: { watchId: number; kind: NotifyKind }): Promise<void> {
    this.notes.push(i);
  }
  async hasRecentVacancyNotification(): Promise<boolean> {
    return this.recentNotify;
  }
  async deleteWatch(): Promise<void> {}
  async latestCheckByWatch(): Promise<
    { watchId: number; checkedAt: string; route: string | null; totalVacant: number | null; lowestPrice: number | null; error: string | null }[]
  > {
    return [];
  }
  close(): void {}
}

const cfg: Config = {
  dbUrl: "postgres://x",
  to: "",
  smtp: { host: "", port: 465, user: "", pass: "", from: "", secure: true },
  stopAfterNotify: false,
  delayMinMs: 0,
  delayMaxMs: 0,
  maxConsecutiveFailures: 3,
  refireWindowMinutes: 360,
};

const watch: Watch = {
  id: 1,
  hotel_code: "00270",
  hotel_name: "群馬伊勢崎駅前",
  checkin_date: "2026-10-06",
  nights: 1,
  rooms: 1,
  people: 1,
  smoking: "all",
  notify_to: null,
  active: true,
  created_at: "",
};

function outcome(vacant: number | null, error: string | null = null): CheckOutcome {
  if (error) return { route: "none", httpStatus: 200, analysis: null, error, snapshotJson: null };
  return {
    route: "ssr",
    httpStatus: 200,
    analysis: {
      hotelCode: "00270",
      hotelTitle: "t",
      totalVacant: vacant ?? 0,
      lowestPrice: vacant && vacant > 0 ? 6210 : null,
      lowestMembershipPrice: null,
      plans: [],
      availablePlansByPrice: [],
    },
    error: null,
    snapshotJson: null,
  };
}

function run(store: FakeStore, o: CheckOutcome, sent: NotifyKind[] = []) {
  return checkWatchOnce(watch, {
    store,
    config: cfg,
    sleep: async () => {},
    log: () => {},
    check: async () => o,
    notifyFn: async () => {},
  }).then(async (r) => {
    // notify を監視できないので、safeNotify は console に出るだけ。insertNotification の記録で判断する
    return r;
  });
}

test("初回観測で空室あり → 通知（vacancy edge, prev=null）", async () => {
  const s = new FakeStore();
  const r = await run(s, outcome(3));
  assert.equal(r, "ok");
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 1);
});

test("2回連続で空室あり → 2回目は通知しない（エッジでない）", async () => {
  const s = new FakeStore();
  await run(s, outcome(3));
  await run(s, outcome(5));
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 1);
});

test("0 → 3 で通知、3 → 0 → 2 で再通知（refire window 未満なら）", async () => {
  const s = new FakeStore();
  await run(s, outcome(0)); // 初回 0 → baseline
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 0);
  await run(s, outcome(3)); // 0→3 通知
  await run(s, outcome(0)); // 3→0
  await run(s, outcome(2)); // 0→2 再通知（refire window は Fake で常に false）
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 2);
});

test("refire window 内は再通知しない", async () => {
  const s = new FakeStore();
  await run(s, outcome(0));
  await run(s, outcome(3)); // 通知
  s.setRecentNotify(true);
  await run(s, outcome(0));
  await run(s, outcome(4)); // edge だが直近通知済み
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 1);
});

test("stopAfterNotify=true で通知後に active=false", async () => {
  const s = new FakeStore();
  const r = await checkWatchOnce(watch, {
    store: s,
    config: { ...cfg, stopAfterNotify: true },
    sleep: async () => {},
    log: () => {},
    check: async () => outcome(7),
    notifyFn: async () => {},
  });
  assert.equal(r, "ok");
  assert.equal(s.actives.get(1), false);
});

test("連続 maxConsecutiveFailures 回の失敗でエラー通知を1回出す", async () => {
  const s = new FakeStore();
  await run(s, outcome(null, "boom"));
  await run(s, outcome(null, "boom"));
  const before = s.notes.filter((n) => n.kind === "error").length;
  await run(s, outcome(null, "boom")); // 3回目
  const after = s.notes.filter((n) => n.kind === "error").length;
  assert.ok(after > before, "3回目でエラー通知が増える");
  await run(s, outcome(null, "boom")); // 4回目は増えない（3の倍数のみ）
  assert.equal(s.notes.filter((n) => n.kind === "error").length, after);
});

test("失敗を挟んでも前回値はリセットされない（lastGood は成功のみ）", async () => {
  const s = new FakeStore();
  await run(s, outcome(5));
  await run(s, outcome(null, "x")); // 失敗
  await run(s, outcome(0)); // 成功 0 → prev=5 なのでエッジでない
  assert.equal(s.notes.filter((n) => n.kind === "vacancy").length, 1);
});
