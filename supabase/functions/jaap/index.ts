// Naam Jaap – reminders and summaries by web push.
// Actions (POST JSON {action, ...}):
//   tick    → send whatever is due (pg_cron every minute, needs x-cron-key header)
//   test    → test push to the signed-in user                 (Authorization: Bearer <session>)
//   snooze  → {reminder_id} with a session, or {log_id, token} from the notification's Snooze button
//   preview → {reminder_id}: what this reminder would say right now, without sending anything
//
// Reliability:
//   • every delivery is claimed by inserting a unique dedupe_key into jaap_delivery_logs first, so
//     overlapping runs (or a re-run) can never send the same reminder twice
//   • a failed send is retried on later ticks, up to MAX_ATTEMPTS, inside a one-hour window
//   • a user can pause everything (jaap_settings.paused_until); nothing is sent or queued while paused
//   • the time is evaluated in the reminder's own IANA time zone on every tick, so daylight-saving
//     changes need no special handling: 6:00 stays 6:00 local
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1/jaap";
const MALA = 108, WINDOW_MIN = 60, MAX_ATTEMPTS = 3;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function secret(key: string) {
  const { data } = await db.from("sk_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}
// Same VAPID keys as the `sankalp` function: the phone has one push subscription for the whole app.
async function vapid() {
  let pub = await secret("vapid_public");
  let priv = await secret("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await db.from("sk_secrets").upsert([
      { key: "vapid_public", value: k.publicKey },
      { key: "vapid_private", value: k.privateKey },
    ]);
    pub = k.publicKey; priv = k.privateKey;
  }
  webpush.setVapidDetails("mailto:sankalp@example.com", pub, priv);
  return pub;
}
async function hmac(msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode((await secret("cron_key")) || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("jaap-snooze:" + msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type SendResult = { sent: number; subs: number; transient: number; error: string | null };
async function pushToUser(userId: string, payload: Record<string, unknown>): Promise<SendResult> {
  await vapid();
  const { data: members } = await db.from("sk_members").select("id").eq("user_id", userId);
  const ids = (members ?? []).map((m) => m.id);
  const out: SendResult = { sent: 0, subs: 0, transient: 0, error: null };
  if (!ids.length) return out;
  const { data: subs } = await db.from("sk_push_subs").select("*").in("member_id", ids);
  out.subs = (subs ?? []).length;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "high" },
      );
      out.sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await db.from("sk_push_subs").delete().eq("endpoint", s.endpoint);   // the phone unsubscribed
        out.error = "subscription expired";
      } else { out.transient++; out.error = `push service ${code ?? "error"}: ${String(e).slice(0, 160)}`; }
    }
  }
  return out;
}

async function userOf(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user ?? null;
}

// ---- time in the reminder's own zone ----
function localNow(tz: string, at = new Date()) {
  let f: Intl.DateTimeFormat;
  const opt = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" } as const;
  try { f = new Intl.DateTimeFormat("en-US", { ...opt, timeZone: tz }); }
  catch { f = new Intl.DateTimeFormat("en-US", { ...opt, timeZone: "Asia/Kolkata" }); }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: +p.hour * 60 + +p.minute,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const addDays = (s: string, n: number) => new Date(Date.parse(s + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const plural = (n: number, w: string) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function progress(userId: string, from: string, to: string) {
  const { data } = await db.from("jaap_daily_progress").select("mantra_id,local_date,count").eq("user_id", userId).gte("local_date", from).lte("local_date", to);
  return data ?? [];
}
const repsOf = (rows: Row[], mantra?: string | null) => rows.filter((r) => !mantra || r.mantra_id === mantra).reduce((n, r) => n + r.count, 0);
const malasOf = (rows: Row[], mantra?: string | null) => rows.filter((r) => !mantra || r.mantra_id === mantra).reduce((n, r) => n + Math.floor(r.count / MALA), 0);

// daily goals that apply on `date`: the newest row per (type, mantra)
async function dailyGoals(userId: string, date: string, mantra?: string | null) {
  const { data } = await db.from("jaap_goals").select("*").eq("user_id", userId).in("goal_type", ["daily_reps", "daily_malas"])
    .lte("effective_from", date).or(`effective_until.is.null,effective_until.gte.${date}`);
  const best: Record<string, Row> = {};
  for (const g of data ?? []) {
    if (mantra && g.mantra_id && g.mantra_id !== mantra) continue;
    const k = g.goal_type + "|" + (g.mantra_id ?? "");
    if (!best[k] || g.effective_from > best[k].effective_from) best[k] = g;
  }
  return Object.values(best);
}
function goalState(g: Row, today: Row[]) {
  const malas = g.goal_type === "daily_malas";
  const done = malas ? malasOf(today, g.mantra_id) : repsOf(today, g.mantra_id);
  return { done, target: g.target_count as number, met: done >= g.target_count, unit: malas ? "mala" : "repetition" };
}

// What to say. Returns null (with a reason) when there is nothing worth sending.
async function compose(r: Row, now: { date: string }): Promise<{ title: string; body: string } | { skip: string }> {
  const { data: mantras } = await db.from("jaap_mantras").select("id,name").eq("user_id", r.user_id);
  const nameOf = (id: string | null) => (mantras ?? []).find((m) => m.id === id)?.name as string | undefined;
  const mantra = r.mantra_id ? nameOf(r.mantra_id) : undefined;
  const today = await progress(r.user_id, now.date, now.date);

  switch (r.reminder_type) {
    case "incomplete_goal": {
      const goals = await dailyGoals(r.user_id, now.date, r.mantra_id);
      if (!goals.length) return { skip: "no daily goal set" };
      const open = goals.map((g) => ({ g, s: goalState(g, today) })).filter((x) => !x.s.met);
      if (!open.length) return { skip: "daily goal already complete" };
      const { g, s } = open[0];
      const which = g.mantra_id && nameOf(g.mantra_id) ? ` ${nameOf(g.mantra_id)}` : "";
      return {
        title: r.name,
        body: `You have completed ${num(s.done)} of your ${num(s.target)}${which} ${s.unit}s today.` +
          (open.length > 1 ? ` ${open.length - 1} more goal${open.length > 2 ? "s are" : " is"} still open.` : " There is still time."),
      };
    }
    case "resume": {
      let q = db.from("jaap_sessions").select("id,mantra_id,count,started_at").eq("user_id", r.user_id).eq("status", "active").gt("count", 0)
        .gte("started_at", new Date(Date.now() - 36 * 3600 * 1000).toISOString()).order("started_at", { ascending: false }).limit(1);
      if (r.mantra_id) q = q.eq("mantra_id", r.mantra_id);
      const { data } = await q;
      if (!data?.length) return { skip: "no unfinished session" };
      const n = nameOf(data[0].mantra_id) ?? "Jaap";
      return { title: r.name, body: `Your ${n} session is waiting at ${plural(data[0].count, "repetition")}. Continue whenever you are ready.` };
    }
    case "daily_summary": {
      const reps = repsOf(today), malas = malasOf(today);
      if (!reps) return { title: r.name, body: "No Jaap recorded today. A few quiet repetitions before sleep are always welcome." };
      const goals = await dailyGoals(r.user_id, now.date, null);
      let tail = "";
      if (goals.length) {
        const st = goals.map((g) => goalState(g, today));
        const met = st.filter((s) => s.met).length;
        tail = goals.length === 1
          ? (st[0].met ? " Daily goal complete." : ` ${num(st[0].done)} of ${num(st[0].target)} ${st[0].unit}s toward your goal.`)
          : ` ${met} of ${goals.length} daily goals complete.`;
      }
      return { title: r.name, body: `Today: ${plural(reps, "repetition")}, ${plural(malas, "mala")} completed.${tail}` };
    }
    case "weekly_reflection": {
      const week = await progress(r.user_id, addDays(now.date, -6), now.date);
      const reps = repsOf(week);
      if (!reps) return { title: r.name, body: "A quiet week. Your practice is here whenever you return to it." };
      const days = new Set(week.filter((x) => x.count > 0).map((x) => x.local_date)).size;
      return { title: r.name, body: `Your week in Jaap: ${plural(reps, "repetition")} across ${days} day${days === 1 ? "" : "s"}.` };
    }
    default: {
      const practised = repsOf(today, r.mantra_id) > 0;
      const goal = r.target_count ? ` Today's intention: ${plural(r.target_count, "repetition")}.` : "";
      if (mantra && practised) return { title: r.name, body: `A gentle reminder to continue your ${mantra} practice.${goal}` };
      if (mantra) return { title: r.name, body: `Your ${mantra} Jaap awaits. A peaceful moment for yourself.${goal}` };
      return { title: r.name, body: `Your Naam Jaap awaits. A peaceful moment for yourself.${goal}` };
    }
  }
}

async function payloadFor(r: Row, logId: string, title: string, body: string) {
  const canAct = ["scheduled", "incomplete_goal", "resume"].includes(r.reminder_type);
  return {
    title, body, tag: `jaap-${r.id}`, silent: r.sound === "silent",
    url: `./?jaap=${canAct ? "remind" : "journey"}&r=${r.id}`,
    actions: canAct ? [{ action: "open", title: "Begin" }, { action: "snooze", title: `Snooze ${r.snooze_minutes} min` }] : [],
    snooze: canAct ? { fn: FN_URL, log_id: logId, token: await hmac(logId) } : null,
  };
}

async function finish(logId: string, attempt: number, res: SendResult) {
  const now = new Date().toISOString();
  let patch: Row;
  if (res.sent > 0) patch = { delivery_status: "sent", delivered_at: now, error: null };
  else if (!res.subs) patch = { delivery_status: "no_subscription", error: "no device has notifications enabled" };
  else if (res.transient > 0 && attempt < MAX_ATTEMPTS) patch = { delivery_status: "retrying", error: res.error };
  else patch = { delivery_status: "failed", error: res.error ?? "could not deliver" };
  await db.from("jaap_delivery_logs").update({ ...patch, attempt_count: attempt, updated_at: now }).eq("id", logId);
  return patch.delivery_status as string;
}

async function deliver(r: Row, key: string, kind: string, scheduledFor: Date, now: { date: string }) {
  // claim: only one run can insert this key
  const { data: claim, error } = await db.from("jaap_delivery_logs")
    .insert({ reminder_id: r.id, user_id: r.user_id, dedupe_key: key, kind, scheduled_for: scheduledFor.toISOString(), delivery_status: "pending", attempt_count: 1 })
    .select("id").maybeSingle();
  if (error || !claim) return "duplicate";       // 23505: already handled (or being handled) elsewhere
  const msg = await compose(r, now);
  if ("skip" in msg) {
    await db.from("jaap_delivery_logs").update({ delivery_status: "skipped", error: msg.skip, updated_at: new Date().toISOString() }).eq("id", claim.id);
    return "skipped";
  }
  await db.from("jaap_delivery_logs").update({ title: msg.title, body: msg.body }).eq("id", claim.id);
  const res = await pushToUser(r.user_id, await payloadFor(r, claim.id, msg.title, msg.body));
  return finish(claim.id, 1, res);
}

async function retries(paused: Set<string>) {
  const since = Date.now() - WINDOW_MIN * 60000;
  const stale = Date.now() - 2 * 60000;
  const { data: logs } = await db.from("jaap_delivery_logs").select("*").in("delivery_status", ["retrying", "pending"]);
  const out: string[] = [];
  for (const l of logs ?? []) {
    if (l.delivery_status === "pending" && Date.parse(l.updated_at) > stale) continue;          // another run is on it right now
    if (Date.parse(l.scheduled_for) < since || l.attempt_count >= MAX_ATTEMPTS || !l.title) {
      await db.from("jaap_delivery_logs").update({ delivery_status: "failed", error: l.error ?? "gave up", updated_at: new Date().toISOString() })
        .eq("id", l.id).eq("delivery_status", l.delivery_status);
      out.push("failed"); continue;
    }
    // compare-and-swap so two runs cannot both retry
    const { data: got } = await db.from("jaap_delivery_logs")
      .update({ delivery_status: "pending", attempt_count: l.attempt_count + 1, updated_at: new Date().toISOString() })
      .eq("id", l.id).eq("delivery_status", l.delivery_status).eq("attempt_count", l.attempt_count).select("id").maybeSingle();
    if (!got) continue;
    const { data: r } = await db.from("jaap_reminders").select("*").eq("id", l.reminder_id).maybeSingle();
    if (!r || !r.enabled || paused.has(l.user_id)) {
      await db.from("jaap_delivery_logs").update({ delivery_status: "skipped", error: paused.has(l.user_id) ? "reminders are paused" : "reminder was turned off" }).eq("id", l.id);
      out.push("skipped"); continue;
    }
    const res = await pushToUser(l.user_id, await payloadFor(r, l.id, l.title, l.body));
    out.push(await finish(l.id, l.attempt_count + 1, res));
  }
  return out;
}

// users who have paused all their reminders for now
async function pausedUsers() {
  const { data } = await db.from("jaap_settings").select("user_id").gt("paused_until", new Date().toISOString());
  return new Set((data ?? []).map((x) => x.user_id as string));
}

async function tick() {
  const { data: rows } = await db.from("jaap_reminders").select("*").eq("enabled", true);
  const paused = await pausedUsers();
  const results: string[] = [];
  const nowMs = Date.now();
  for (const r of rows ?? []) {
    if (paused.has(r.user_id)) { results.push("paused"); continue; }
    try {
      const now = localNow(r.timezone || "Asia/Kolkata");
      // a snoozed reminder comes back once, at the snooze time
      if (r.snoozed_until) {
        const due = Date.parse(r.snoozed_until);
        if (due <= nowMs) {
          await db.from("jaap_reminders").update({ snoozed_until: null }).eq("id", r.id);
          if (nowMs - due < WINDOW_MIN * 60000) results.push(await deliver(r, `${r.id}:snooze:${r.snoozed_until}`, r.reminder_type, new Date(due), now));
        }
      }
      const at = toMin(r.scheduled_time);
      const days: number[] = r.days_of_week ?? [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(now.dow) || now.minutes < at || now.minutes - at >= WINDOW_MIN) continue;
      const scheduledFor = new Date(Math.floor(nowMs / 60000) * 60000 - (now.minutes - at) * 60000);
      results.push(await deliver(r, `${r.id}:${now.date}:${String(r.scheduled_time).slice(0, 5)}`, r.reminder_type, scheduledFor, now));
    } catch (e) { console.error("reminder", r.id, e); results.push("error"); }
  }
  results.push(...(await retries(paused)).map((s) => "retry:" + s));
  const tally: Record<string, number> = {};
  results.forEach((s) => { tally[s] = (tally[s] ?? 0) + 1; });
  return tally;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "tick": {
        if (req.headers.get("x-cron-key") !== (await secret("cron_key"))) return json({ error: "forbidden" }, 403);
        return json({ ok: true, results: await tick() });
      }
      case "test": {
        const u = await userOf(req);
        if (!u) return json({ error: "sign in first" }, 401);
        const res = await pushToUser(u.id, { title: "Naam Jaap", body: "Notifications are working. Your reminders will arrive here.", tag: "jaap-test", url: "./?jaap=reminders", actions: [], silent: false });
        return json({ sent: res.sent, devices: res.subs, error: res.error });
      }
      case "snooze": {
        let reminderId: string | null = null, userId: string | null = null;
        if (body.log_id && body.token) {
          if (String(body.token) !== (await hmac(String(body.log_id)))) return json({ error: "forbidden" }, 403);
          const { data: l } = await db.from("jaap_delivery_logs").select("reminder_id,user_id").eq("id", body.log_id).maybeSingle();
          reminderId = l?.reminder_id ?? null; userId = l?.user_id ?? null;
        } else {
          const u = await userOf(req);
          if (!u) return json({ error: "sign in first" }, 401);
          reminderId = String(body.reminder_id ?? ""); userId = u.id;
        }
        if (!reminderId || !userId) return json({ error: "not found" }, 404);
        const { data: r } = await db.from("jaap_reminders").select("id,snooze_minutes").eq("id", reminderId).eq("user_id", userId).maybeSingle();
        if (!r) return json({ error: "not found" }, 404);
        const until = new Date(Math.ceil((Date.now() + r.snooze_minutes * 60000) / 60000) * 60000).toISOString();
        await db.from("jaap_reminders").update({ snoozed_until: until }).eq("id", r.id);
        return json({ ok: true, snoozed_until: until, minutes: r.snooze_minutes });
      }
      case "preview": {
        let q = db.from("jaap_reminders").select("*").eq("id", String(body.reminder_id ?? ""));
        if (req.headers.get("x-cron-key") !== (await secret("cron_key"))) {
          const u = await userOf(req);
          if (!u) return json({ error: "sign in first" }, 401);
          q = q.eq("user_id", u.id);
        }
        const { data: r } = await q.maybeSingle();
        if (!r) return json({ error: "not found" }, 404);
        const now = localNow(r.timezone || "Asia/Kolkata");
        return json({ now, message: await compose(r, now) });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
