// フェッチャ: 主ルート(SSR planResponse) + 副ルート(tRPC calendar) + フォールバック
import type { PlanResponse, CheckOutcome, Route } from "./types.mts";
import { analyze } from "./analyze.mts";
import type { SmokingFilter } from "./types.mts";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BASE = "https://www.toyoko-inn.com";
const FETCH_TIMEOUT_MS = 15_000;

/** 403/429 等の「即停止すべき」HTTPエラー */
export class BlockError extends Error {
  public status: number;
  constructor(status: number) {
    super(`blocked: HTTP ${status}`);
    this.status = status;
    this.name = "BlockError";
  }
}

function buildSearchUrl(hotelCode: string, start: string, end: string, rooms: number, people: number): URL {
  const url = new URL("/search/result/room_plan/", BASE);
  url.searchParams.set("hotel", hotelCode);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("room", String(rooms));
  url.searchParams.set("people", String(people));
  url.searchParams.set("smoking", "all");
  url.searchParams.set("tab", "roomType");
  url.searchParams.set("sort", "recommend");
  return url;
}

/** HTMLからplanResponseを抽出: __NEXT_DATA__優先 → バランス括弧フォールバック */
export function extractPlanResponse(html: string): PlanResponse | null {
  // 1) __NEXT_DATA__ 経由（確実パス: props.pageProps.planResponse）
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const pr = data?.props?.pageProps?.planResponse;
      if (pr && typeof pr === "object") return pr as PlanResponse;
    } catch {
      /* fallthrough */
    }
  }
  // 2) "planResponse":{...} をバランス括弧で切り出し
  const raw = extractBalancedObject(html, '"planResponse":');
  if (raw) {
    try {
      return JSON.parse(raw) as PlanResponse;
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

/** マーカー直後のJSONオブジェクトを brace 深度追跡で切り出す（文字列内の括弧を無視） */
export function extractBalancedObject(text: string, marker: string): string | null {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = text.indexOf("{", idx + marker.length - 1);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return text.slice(start, j + 1);
      }
    }
  }
  return null;
}

async function httpGet(url: URL | string, accept: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: accept },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** 主ルート: 1リクエスト取得（リトライ・遅延は上位の checkOnce で制御） */
export async function fetchSsr(hotelCode: string, start: string, end: string, rooms: number, people: number) {
  const url = buildSearchUrl(hotelCode, start, end, rooms, people);
  const { status, text } = await httpGet(url, "text/html");
  return { status, text };
}

/** superjsonエンコード（Date → meta.values:["Date"]） */
export function toSuperjson(o: Record<string, unknown>): string {
  const json: Record<string, unknown> = {};
  const values: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v instanceof Date) {
      json[k] = v.toISOString();
      values[k] = ["Date"];
    } else json[k] = v;
  }
  return Object.keys(values).length ? JSON.stringify({ json, meta: { values } }) : JSON.stringify({ json });
}

export interface CalendarDay {
  date: string;
  membershipVacantRoom: number;
  generalVacantRoom: number;
}

/** 副ルート: tRPC 空室カレンダー（存在するroomTypeId必須） */
export async function fetchCalendar(hotelCode: string, roomTypeId: string, checkIn: Date, people = 1): Promise<CalendarDay[]> {
  const input = toSuperjson({ hotelCode, roomTypeId, checkInDate: checkIn, numberOfPeople: people });
  const url = `${BASE}/api/trpc/hotels.availabilities.room.calendar?input=${encodeURIComponent(input)}`;
  const { status, text } = await httpGet(url, "application/json");
  if (status === 403 || status === 429) throw new BlockError(status);
  if (status < 200 || status >= 300) throw new Error(`trpc HTTP ${status}`);
  const body = JSON.parse(text);
  const vacant = body?.result?.data?.json?.vacant;
  if (!Array.isArray(vacant)) throw new Error("trpc unexpected shape");
  return vacant as CalendarDay[];
}

/** カレンダー配列から指定チェックイン日の空室数を拾う（ISO日付部分一致） */
export function calendarVacantFor(days: CalendarDay[], checkinDate: string): number | null {
  const hit = days.find((d) => d.date === checkinDate);
  return hit ? hit.generalVacantRoom : null;
}

/** 単一監視の1チェック: SSR→planResponse、無ければtRPC calendarへフォールバック */
export async function checkOnce(
  watch: { hotel_code: string; checkin_date: string; nights: number; rooms: number; people: number },
  smoking: SmokingFilter,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<CheckOutcome> {
  const start = watch.checkin_date;
  const end = addDays(start, watch.nights);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // 指数バックオフで最大3回試行（403/429は即throw）
  let lastStatus: number | null = null;
  let lastErr: string | null = null;
  let pr: PlanResponse | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, text } = await fetchSsr(watch.hotel_code, start, end, watch.rooms, watch.people);
      lastStatus = status;
      if (status === 403 || status === 429) throw new BlockError(status);
      if (status >= 500) {
        lastErr = `SSR HTTP ${status}`;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (status >= 200 && status < 300) {
        pr = extractPlanResponse(text);
        if (pr) break;
        lastErr = "planResponse not found in SSR";
      } else {
        lastErr = `SSR HTTP ${status}`;
      }
    } catch (e) {
      if (e instanceof BlockError) throw e;
      lastErr = (e as Error).message;
    }
    await sleep(1000 * 2 ** attempt);
  }

  if (pr) {
    return {
      route: "ssr",
      httpStatus: lastStatus ?? 200,
      analysis: analyze(pr, smoking),
      error: null,
      snapshotJson: JSON.stringify(pr),
    };
  }

  // 副ルート: tRPC calendar（roomTypeId が欲しいので planResponse 不在時は代表 "S" を試す）
  try {
    const days = await fetchCalendar(watch.hotel_code, "S", new Date(start + "T00:00:00.000Z"), watch.people);
    const v = calendarVacantFor(days, start);
    if (v !== null) {
      const analysis = {
        hotelCode: watch.hotel_code,
        hotelTitle: null,
        totalVacant: v,
        lowestPrice: null,
        lowestMembershipPrice: null,
        plans: [],
        availablePlansByPrice: [],
      };
      return { route: "trpc", httpStatus: lastStatus, analysis, error: null, snapshotJson: JSON.stringify(days) };
    }
  } catch (e) {
    if (e instanceof BlockError) throw e;
    lastErr = (e as Error).message;
  }

  return { route: "none", httpStatus: lastStatus, analysis: null, error: lastErr ?? "no data", snapshotJson: null };
}

/** 'YYYY-MM-DD' に日数加算（UTC基準・時刻なし） */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
