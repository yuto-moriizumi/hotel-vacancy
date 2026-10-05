// 通知（smtp メール）
import type { Config } from "./config.mts";
import type { Analysis, Watch, NotifyKind } from "./types.mts";

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const yen = (n: number | null | undefined, dash = "-") => (n == null ? dash : n.toLocaleString("ja-JP") + "円");

/** 通知本文（0→上行検知時） */
export function formatVacancyMessage(watch: Watch, a: Analysis): string {
  const link = `https://www.toyoko-inn.com/search/detail/${watch.hotel_code}/`;
  const name = watch.hotel_name ?? a.hotelTitle ?? watch.hotel_code;
  const end = addDaysIso(watch.checkin_date, watch.nights);
  const lines: string[] = [
    `【東横イン 空室あり】${name}`,
    `日程: ${watch.checkin_date} 〜 ${end}（${watch.nights}泊）`,
    `条件: ${watch.rooms}部屋 / ${watch.people}名 / 禁煙=${watch.smoking}`,
    `空室(合計): ${a.totalVacant}室 / 最安 一般${yen(a.lowestPrice)} 会員${yen(a.lowestMembershipPrice)}`,
    "",
    "上位プラン（空室あり・安い順）:",
  ];
  const top = a.availablePlansByPrice.slice(0, 3);
  if (top.length === 0) lines.push("（詳細なし）");
  top.forEach((p, i) => {
    lines.push(
      `  ${i + 1}. ${p.roomTypeName ?? p.roomTypeId} / ${p.planName ?? p.planCode ?? "-"}  一般${yen(p.generalPrice)} 空${p.generalVacant}室`,
    );
  });
  lines.push("", `公式サイト: ${link}`, "", "※ 自動検知の通知です。空室は変動するため公式サイトで最新をご確認ください。");
  return lines.join("\n");
}

export function formatErrorMessage(watch: Watch | null, msg: string): string {
  const head = watch ? `【東横イン 監視エラー】${watch.hotel_name ?? watch.hotel_code} (id=${watch.id})` : "【東横イン 監視エラー】";
  return `${head}\n${msg}`;
}

export async function notify(config: Config, kind: NotifyKind, subject: string, body: string, to?: string): Promise<void> {
  void kind;
  const dest = to || config.to;
  if (!config.smtp?.host || !dest) throw new Error("SMTP_HOST / 通知先メールアドレス（監視ごと または TOYOKO_TO）が未設定です");
  const { createTransport } = await import("nodemailer");
  const tr = createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await tr.sendMail({ from: config.smtp.from, to: dest, subject, text: body });
}
