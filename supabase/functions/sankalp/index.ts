// Sankalp – push notifications for the sadhana tracker.
// Actions (POST JSON {action, ...}):
//   vapid  → { publicKey }
//   test   → test push to the signed-in member   (Authorization: Bearer <session>)
//   cheer  → tell the rest of the family         {title, body} (Authorization: Bearer <session>)
//   tick   → reminder sweep (pg_cron, needs x-cron-key header)
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

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

async function pushTo(memberIds: string[], payload: Record<string, unknown>) {
  if (!memberIds.length) return 0;
  await vapid();
  const { data: subs } = await db.from("sk_push_subs").select("*").in("member_id", memberIds);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("sk_push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, String(e));
    }
  }
  return sent;
}

// Resolve the signed-in user's member row from their Supabase session token.
async function caller(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: m } = await db.from("sk_members").select("id,family_code,name").eq("user_id", data.user.id).limit(1).maybeSingle();
  return m;
}

// ---- date helpers (local to the member's time zone) ----
function localNow(tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

async function tick() {
  const { data: rows } = await db
    .from("sk_sadhanas")
    .select("*, sk_members!inner(id,name,tz)")
    .eq("status", "active")
    .or("reminder_time.not.is.null,nudge_time.not.is.null");
  let sent = 0;
  for (const s of rows ?? []) {
    const tz = s.sk_members.tz || "Asia/Kolkata";
    const now = localNow(tz);
    const excused: string[] = s.excused_dates ?? [];
    const span = dayDiff(s.start_date, now.date);
    if (span < 0 || span >= s.total_days + excused.length) continue;
    if (excused.includes(now.date)) continue;
    const day = span + 1 - excused.filter((d) => d < now.date).length;

    const { data: log } = await db.from("sk_logs").select("count").eq("sadhana_id", s.id).eq("log_date", now.date).maybeSingle();
    const done = log?.count ?? 0;
    if (done >= s.daily_target) continue;

    const due = (t: string | null, last: string | null) =>
      t && last !== now.date && now.minutes >= toMin(t) && now.minutes - toMin(t) < 60;

    const progress = s.daily_target > 1 ? ` · ${done}/${s.daily_target} ${s.unit}` : "";
    if (due(s.reminder_time, s.last_reminded_on)) {
      sent += await pushTo([s.member_id], {
        title: `🙏 ${s.title}`,
        body: `Day ${day} of ${s.total_days}${progress}. Jai Shri Ram!`,
        tag: `remind-${s.id}`, url: "./",
      });
      await db.from("sk_sadhanas").update({ last_reminded_on: now.date }).eq("id", s.id);
    } else if (due(s.nudge_time, s.last_nudged_on)) {
      sent += await pushTo([s.member_id], {
        title: `⏳ ${s.title} still pending`,
        body: `Day ${day} isn't complete yet${progress}. A few minutes keeps the sankalp unbroken.`,
        tag: `remind-${s.id}`, url: "./",
      });
      await db.from("sk_sadhanas").update({ last_nudged_on: now.date }).eq("id", s.id);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "vapid":
        return json({ publicKey: await vapid() });
      case "test": {
        const me = await caller(req);
        if (!me) return json({ error: "sign in first" }, 401);
        const n = await pushTo([me.id], { title: "🔔 Notifications are on", body: "Jai Hanuman! Reminders will arrive here.", tag: "test", url: "./" });
        return json({ sent: n });
      }
      case "cheer": {
        const me = await caller(req);
        if (!me) return json({ error: "sign in first" }, 401);
        const { data: others } = await db.from("sk_members").select("id").eq("family_code", me.family_code).neq("id", me.id);
        const n = await pushTo((others ?? []).map((o) => o.id), {
          title: String(body.title ?? "").slice(0, 80), body: String(body.body ?? "").slice(0, 160), tag: "cheer", url: "./",
        });
        return json({ sent: n });
      }
      case "tick": {
        if (req.headers.get("x-cron-key") !== (await secret("cron_key"))) return json({ error: "forbidden" }, 403);
        return json({ sent: await tick() });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
