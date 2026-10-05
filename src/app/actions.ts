"use server";

// 監視の追加/変更/削除・即時チェック（Server Actions）
import { revalidatePath } from "next/cache";
import { loadConfig, parseSmoking } from "../watcher/config.mts";
import { makeNeonDb, Store } from "../watcher/store.mts";
import { checkWatchOnce } from "../watcher/watcher.mts";
import { isValidIsoDate } from "../watcher/fetcher.mts";
import { HOTELS_BY_CODE } from "./hotels";

export interface AddFormState {
  error: string | null;
  ok: boolean;
  message: string | null;
}

function getStore(): Store {
  const cfg = loadConfig();
  return new Store(makeNeonDb(cfg.dbUrl));
}

export async function addWatchAction(_prev: AddFormState, formData: FormData): Promise<AddFormState> {
  const hotel_code = String(formData.get("hotel") ?? "").trim();
  const hotel_name = HOTELS_BY_CODE.get(hotel_code) ?? null;
  const start = String(formData.get("start") ?? "").trim();
  const nights = Number(formData.get("nights") ?? 1);
  const rooms = Number(formData.get("rooms") ?? 1);
  const people = Number(formData.get("people") ?? 1);
  const smoking = parseSmoking(String(formData.get("smoking") ?? "all"));
  const email = String(formData.get("email") ?? "").trim();

  if (!/^\d{5}$/.test(hotel_code) || !HOTELS_BY_CODE.has(hotel_code)) return { error: "ホテルを一覧から選択してください", ok: false, message: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "通知先メールアドレスを正しく入力してください", ok: false, message: null };
  if (!isValidIsoDate(start)) return { error: "チェックイン日を正しく指定してください", ok: false, message: null };
  const d = new Date(start + "T00:00:00Z");
  if (d.getTime() < Date.now() - 86_400_000) return { error: "過去の日付は指定できません", ok: false, message: null };
  if (!Number.isInteger(nights) || nights < 1 || nights > 9) return { error: "泊数は1〜9で指定してください", ok: false, message: null };
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > 4) return { error: "部屋数は1〜4で指定してください", ok: false, message: null };
  if (!Number.isInteger(people) || people < 1 || people > rooms * 6) return { error: "人数は部屋数の範囲内で指定してください", ok: false, message: null };

  try {
    const store = getStore();
    try {
      const id = await store.addWatch({ hotel_code: hotel_code, hotel_name: hotel_name, checkin_date: start, nights, rooms, people, smoking, notify_to: email });
      return { error: null, ok: true, message: `監視を登録しました（id=${id}）` };
    } finally {
      store.close();
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ok: false, message: null };
  } finally {
    revalidatePath("/");
  }
}

export async function setWatchActiveAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const active = formData.get("active") === "1";
  if (!Number.isInteger(id)) return;
  const store = getStore();
  try {
    await store.setActive(id, active);
  } finally {
    store.close();
    revalidatePath("/");
  }
}

export async function deleteWatchAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  const store = getStore();
  try {
    await store.deleteWatch(id);
  } finally {
    store.close();
    revalidatePath("/");
  }
}

/** 1監視を即時チェック（公式サイトへ1リクエスト・記録と通知判断込み） */
export async function checkNowAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  const cfg = loadConfig();
  const store = new Store(makeNeonDb(cfg.dbUrl));
  try {
    const w = await store.getWatch(id);
    if (w && w.active) await checkWatchOnce(w, { store, config: cfg });
  } catch {
    // 失敗は checks テーブルに記録済み。UIでは再描画のみ。
  } finally {
    store.close();
    revalidatePath("/");
  }
}
