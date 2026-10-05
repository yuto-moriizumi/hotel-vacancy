"use client";

import { useActionState } from "react";
import { addWatchAction, type AddFormState } from "./actions";

const input =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500";
const label = "block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1";

export default function AddForm() {
  const [state, formAction, pending] = useActionState<AddFormState, FormData>(addWatchAction, {
    error: null,
    ok: false,
    message: null,
  });

  // チェックイン日の初期値 = 翌日
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <label className={label} htmlFor="hotel">
          ホテルコード（5桁）
        </label>
        <input id="hotel" name="hotel" placeholder="00270" inputMode="numeric" pattern="\d{5}" required className={input} />
      </div>
      <div>
        <label className={label} htmlFor="name">
          ホテル名（メモ・任意）
        </label>
        <input id="name" name="name" placeholder="群馬伊勢崎駅前" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="start">
          チェックイン日
        </label>
        <input id="start" name="start" type="date" defaultValue={tomorrow} required className={input} />
      </div>
      <div>
        <label className={label} htmlFor="nights">
          泊数
        </label>
        <input id="nights" name="nights" type="number" min={1} max={9} defaultValue={1} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="rooms">
          部屋数
        </label>
        <input id="rooms" name="rooms" type="number" min={1} max={4} defaultValue={1} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="people">
          人数
        </label>
        <input id="people" name="people" type="number" min={1} max={6} defaultValue={1} className={input} />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label className={label} htmlFor="smoking">
          喫煙希望
        </label>
        <select id="smoking" name="smoking" defaultValue="no_smoking" className={input}>
          <option value="no_smoking">禁煙</option>
          <option value="smoking">喫煙</option>
          <option value="all">指定なし</option>
        </select>
      </div>
      <div className="col-span-2">
        <label className={label} htmlFor="email">
          通知先メールアドレス
        </label>
        <input id="email" name="email" type="email" placeholder="you@example.com" required className={input} />
      </div>
      <div className="col-span-2 flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "登録中…" : "監視を登録"}
        </button>
      </div>
      {state.error && <p className="col-span-full text-sm text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="col-span-full text-sm text-emerald-600">{state.message}</p>}
    </form>
  );
}
