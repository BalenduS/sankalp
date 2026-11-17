// Naam Jaap — pure calculations (no DOM, no network). Used by jaap.js in the app and by tests/ in Node.
// Dates are local calendar days as 'YYYY-MM-DD' strings. An "event" is one session's repetitions on one
// local day: { session_id, local_date, mantra_id, count, seconds, first_at, last_at }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JaapCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MALA = 108;
  const IDLE_CAP = 90;            // seconds: a pause longer than this is not counted as practice time
  const STD_MILESTONES = [108, 1008, 10008, 100008, 1000008];

  // ---------------------------------------------------------------- dates
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fromUtc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const addDays = (s, n) => fromUtc(utc(s) + n * 864e5);
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  const dow = (s) => new Date(utc(s)).getUTCDay();                 // 0 = Sunday
  const weekStart = (s) => addDays(s, -((dow(s) + 6) % 7));        // Monday
  const monthStart = (s) => s.slice(0, 8) + '01';
  const monthEnd = (s) => { const [y, m] = s.split('-').map(Number); return fromUtc(Date.UTC(y, m, 0)); };
  const yearStart = (s) => s.slice(0, 4) + '-01-01';
  const minDate = (a, b) => (a < b ? a : b);
  const maxDate = (a, b) => (a > b ? a : b);
  function eachDay(from, to, fn) { for (let d = from; d <= to; d = addDays(d, 1)) fn(d); }

  // ---------------------------------------------------------------- day index
  // Map<date, { date, count, seconds, byMantra: { [id]: { count, seconds } } }>
  function buildDays(events, mantraId) {
    const days = new Map();
    for (const e of events) {
      if (mantraId && e.mantra_id !== mantraId) continue;
      if (!(e.count > 0) && !(e.seconds > 0)) continue;
      let d = days.get(e.local_date);
      if (!d) { d = { date: e.local_date, count: 0, seconds: 0, byMantra: {} }; days.set(e.local_date, d); }
      d.count += e.count || 0; d.seconds += e.seconds || 0;
      const m = d.byMantra[e.mantra_id] || (d.byMantra[e.mantra_id] = { count: 0, seconds: 0 });
      m.count += e.count || 0; m.seconds += e.seconds || 0;
    }
    return days;
  }
  // A mala is 108 repetitions of one mantra within one day.
  const malasOfDay = (day, mantraId) => {
    if (!day) return 0;
    if (mantraId) return Math.floor(((day.byMantra[mantraId] || {}).count || 0) / MALA);
    let n = 0; for (const k in day.byMantra) n += Math.floor(day.byMantra[k].count / MALA); return n;
  };
  const repsOfDay = (day, mantraId) => !day ? 0 : mantraId ? ((day.byMantra[mantraId] || {}).count || 0) : day.count;
  const secondsOfDay = (day, mantraId) => !day ? 0 : mantraId ? ((day.byMantra[mantraId] || {}).seconds || 0) : day.seconds;
  const firstDate = (days) => { let f = null; for (const k of days.keys()) if (!f || k < f) f = k; return f; };
  const activeDates = (days, mantraId) => [...days.values()].filter((d) => repsOfDay(d, mantraId) > 0).map((d) => d.date).sort();

  function sumRange(days, from, to, mantraId) {
    const out = { reps: 0, malas: 0, seconds: 0, activeDays: 0 };
    for (const d of days.values()) {
      if (d.date < from || d.date > to) continue;
      const r = repsOfDay(d, mantraId);
      out.reps += r; out.malas += malasOfDay(d, mantraId); out.seconds += secondsOfDay(d, mantraId);
      if (r > 0) out.activeDays++;
    }
    return out;
  }

  // ---------------------------------------------------------------- ranges
  // key: today | 7 | 30 | 90 | year | all | custom
  function rangeFor(key, today, first, custom) {
    switch (String(key)) {
      case 'today': return { from: today, to: today };
      case '7': return { from: addDays(today, -6), to: today };
      case '30': return { from: addDays(today, -29), to: today };
      case '90': return { from: addDays(today, -89), to: today };
      case 'year': return { from: yearStart(today), to: today };
      case 'custom': {
        let a = (custom && custom.from) || today, b = (custom && custom.to) || today;
        if (a > b) { const t = a; a = b; b = t; }
        return { from: a, to: b };
      }
      default: return { from: first && first < today ? first : today, to: today };
    }
  }

  // ---------------------------------------------------------------- streaks
  function currentStreak(dates, today) {
    const set = dates instanceof Set ? dates : new Set(dates);
    let d = set.has(today) ? today : addDays(today, -1), n = 0;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function longestStreak(dates) {
    const list = [...(dates instanceof Set ? dates : new Set(dates))].sort();
    let best = { days: 0, from: null, to: null }, run = 0, start = null, prev = null;
    for (const d of list) {
      if (prev && diffDays(prev, d) === 1) run++; else { run = 1; start = d; }
      if (run > best.days) best = { days: run, from: start, to: d };
      prev = d;
    }
    return best;
  }

  // ---------------------------------------------------------------- overview + series
  function overview(days, range, today) {
    const s = sumRange(days, range.from, range.to);
    return { reps: s.reps, malas: s.malas, seconds: s.seconds, activeDays: s.activeDays, streak: currentStreak(activeDates(days), today) };
  }
  const bucketSize = (range) => { const n = diffDays(range.from, range.to) + 1; return n <= 92 ? 'day' : n <= 732 ? 'week' : 'month'; };
  // metric: reps | malas | time
  function series(days, range, metric, mantraId) {
    const size = bucketSize(range), out = [];
    let cur = null;
    eachDay(range.from, range.to, (d) => {
      const key = size === 'day' ? d : size === 'week' ? weekStart(d) : monthStart(d);
      if (!cur || cur.key !== key) { cur = { key, from: d, to: d, reps: 0, malas: 0, seconds: 0, byMantra: {} }; out.push(cur); }
      cur.to = d;
      const day = days.get(d); if (!day) return;
      cur.reps += repsOfDay(day, mantraId); cur.malas += malasOfDay(day, mantraId); cur.seconds += secondsOfDay(day, mantraId);
      for (const id in day.byMantra) {
        if (mantraId && id !== mantraId) continue;
        const m = cur.byMantra[id] || (cur.byMantra[id] = { count: 0, seconds: 0, malas: 0 });
        m.count += day.byMantra[id].count; m.seconds += day.byMantra[id].seconds; m.malas += Math.floor(day.byMantra[id].count / MALA);
      }
    });
    out.forEach((b) => { b.value = metric === 'malas' ? b.malas : metric === 'time' ? b.seconds : b.reps; });
    return { size, buckets: out, max: out.reduce((m, b) => Math.max(m, b.value), 0) };
  }
  // Heat level 0–4 for a day, relative to the busiest day shown.
  function heatLevel(count, max) {
    if (!(count > 0)) return 0;
    if (!(max > 0)) return 1;
    const f = count / max;
    return f > 0.75 ? 4 : f > 0.5 ? 3 : f > 0.25 ? 2 : 1;
  }
  function heatmap(days, from, to) {
    const start = weekStart(from), end = addDays(weekStart(to), 6);
    let max = 0; eachDay(from, to, (d) => { const c = repsOfDay(days.get(d)); if (c > max) max = c; });
    const weeks = []; let w = null;
    eachDay(start, end, (d) => {
      if (!w || w.length === 7) { w = []; weeks.push(w); }
      const inRange = d >= from && d <= to, c = inRange ? repsOfDay(days.get(d)) : 0;
      w.push({ date: d, inRange, count: c, level: inRange ? heatLevel(c, max) : -1 });
    });
    return { weeks, max };
  }
  function distribution(days, range) {
    const by = {}; let total = 0;
    for (const d of days.values()) {
      if (d.date < range.from || d.date > range.to) continue;
      for (const id in d.byMantra) { by[id] = (by[id] || 0) + d.byMantra[id].count; total += d.byMantra[id].count; }
    }
    return Object.keys(by).filter((id) => by[id] > 0).map((id) => ({ mantra_id: id, reps: by[id], share: total ? by[id] / total : 0 }))
      .sort((a, b) => b.reps - a.reps);
  }

  // ---------------------------------------------------------------- goals
  const GOAL_TYPES = {
    daily_reps: { period: 'day', unit: 'reps', label: 'Daily repetitions' },
    daily_malas: { period: 'day', unit: 'malas', label: 'Daily malas' },
    weekly_malas: { period: 'week', unit: 'malas', label: 'Weekly malas' },
    monthly_reps: { period: 'month', unit: 'reps', label: 'Monthly repetitions' },
  };
  const sameMantra = (a, b) => (a || null) === (b || null);
  const goalActiveOn = (g, date) => g.effective_from <= date && (!g.effective_until || date <= g.effective_until);
  function goalOn(goals, type, mantraId, date) {
    let best = null;
    for (const g of goals) {
      if (g.goal_type !== type || !sameMantra(g.mantra_id, mantraId) || !goalActiveOn(g, date)) continue;
      if (!best || g.effective_from > best.effective_from) best = g;
    }
    return best;
  }
  // one goal per (type, mantra) that applies on `date`
  function goalsOn(goals, date) {
    const seen = {}, out = [];
    for (const g of goals) {
      if (!goalActiveOn(g, date)) continue;
      const k = g.goal_type + '|' + (g.mantra_id || '');
      if (!seen[k] || g.effective_from > seen[k].effective_from) seen[k] = g;
    }
    for (const k in seen) out.push(seen[k]);
    return out;
  }
  function periodOf(type, date) {
    const p = GOAL_TYPES[type].period;
    if (p === 'week') return { from: weekStart(date), to: addDays(weekStart(date), 6) };
    if (p === 'month') return { from: monthStart(date), to: monthEnd(date) };
    return { from: date, to: date };
  }
  function goalProgress(goal, days, date) {
    const t = GOAL_TYPES[goal.goal_type], p = periodOf(goal.goal_type, date), mid = goal.mantra_id || null;
    const s = sumRange(days, p.from, p.to, mid);
    const target = goal.target_count;
    let done, frac;
    if (t.unit === 'malas') {
      done = s.malas;
      const partial = t.period === 'day' && mid ? (s.reps % MALA) / MALA : 0;
      frac = Math.min(1, (done + (done < target ? partial : 0)) / target);
    } else { done = s.reps; frac = Math.min(1, done / target); }
    return { goal, type: goal.goal_type, unit: t.unit, period: p, target, done, reps: s.reps, targetReps: t.unit === 'malas' ? target * MALA : target, frac, met: done >= target };
  }
  // null when no daily goal applied that day; otherwise whether every daily goal was met
  function dayGoalsMet(goals, days, date) {
    const daily = goalsOn(goals, date).filter((g) => GOAL_TYPES[g.goal_type].period === 'day');
    if (!daily.length) return null;
    return daily.every((g) => goalProgress(g, days, date).met);
  }
  function goalDays(goals, days, from, to, mantraId) {
    let total = 0, met = 0;
    const gs = mantraId === undefined ? goals : goals.filter((g) => sameMantra(g.mantra_id, mantraId));
    eachDay(from, to, (d) => { const r = dayGoalsMet(gs, days, d); if (r !== null) { total++; if (r) met++; } });
    return { total, met, pct: total ? Math.round((met / total) * 100) : null };
  }
  // The change to make when a goal is set to a new target (0 / null removes it) starting `today`.
  // Returns { close: [{id, effective_until}], remove: [id], insert: row|null, update: {id, target_count}|null }
  function planGoalChange(goals, type, mantraId, target, today) {
    const out = { close: [], remove: [], insert: null, update: null };
    const cur = goalOn(goals, type, mantraId, today);
    const t = Math.floor(Number(target) || 0);
    if (cur && cur.target_count === t) return out;
    if (cur) {
      if (cur.effective_from === today) {              // changed twice in one day: no history to keep yet
        if (t > 0) out.update = { id: cur.id, target_count: t }; else out.remove.push(cur.id);
        return out;
      }
      out.close.push({ id: cur.id, effective_until: addDays(today, -1) });
    }
    if (t > 0) out.insert = { mantra_id: mantraId || null, goal_type: type, target_count: t, effective_from: today, effective_until: null };
    return out;
  }

  // ---------------------------------------------------------------- sessions
  function sessionTotals(session, events) {
    let count = 0, seconds = 0;
    for (const e of events) if (e.session_id === session.id) { count += e.count || 0; seconds += e.seconds || 0; }
    return { count, seconds, malas: Math.floor(count / MALA) };
  }
  function sessionIndex(events) {
    const by = {};
    for (const e of events) {
      const s = by[e.session_id] || (by[e.session_id] = { count: 0, seconds: 0, dates: [] });
      s.count += e.count || 0; s.seconds += e.seconds || 0; if (e.count > 0) s.dates.push(e.local_date);
    }
    for (const k in by) { by[k].malas = Math.floor(by[k].count / MALA); by[k].dates.sort(); }
    return by;
  }
  // Correcting a session's total: later days absorb the change first. Returns the new buckets.
  function redistribute(buckets, newTotal) {
    const list = buckets.map((b) => Object.assign({}, b)).sort((a, b) => a.local_date.localeCompare(b.local_date));
    const cur = list.reduce((n, b) => n + b.count, 0);
    let delta = Math.max(0, Math.floor(newTotal)) - cur;
    if (!list.length || !delta) return list;
    if (delta > 0) { list[list.length - 1].count += delta; return list; }
    for (let i = list.length - 1; i >= 0 && delta < 0; i--) {
      const take = Math.min(list[i].count, -delta); list[i].count -= take; delta += take;
    }
    return list;
  }
  // One tap on the counter. Mutates and returns the bucket for (session, local day).
  function applyTap(bucket, delta, nowMs, lastTapMs) {
    const before = bucket.count || 0;
    bucket.count = Math.max(0, before + delta);
    if (delta > 0) {
      if (lastTapMs && nowMs > lastTapMs) bucket.seconds = Math.min(86400, (bucket.seconds || 0) + Math.min(IDLE_CAP, Math.round((nowMs - lastTapMs) / 1000)));
      const t = new Date(nowMs).toISOString();
      if (!bucket.first_at) bucket.first_at = t;
      bucket.last_at = t;
    }
    return bucket;
  }
  const HOUR_BANDS = [
    [3, 6, 'before sunrise'], [6, 9, 'in the early morning'], [9, 12, 'in the late morning'], [12, 16, 'in the afternoon'],
    [16, 19, 'in the evening'], [19, 22, 'at night'], [22, 27, 'late at night'],
  ];
  // Needs at least `min` sessions to say anything.
  function practiceTime(sessions, hourOf, min) {
    const hrs = sessions.filter((s) => s.source !== 'manual').map((s) => hourOf(s.started_at));
    if (hrs.length < (min || 5)) return null;
    const n = HOUR_BANDS.map(() => 0);
    hrs.forEach((h) => { const hh = h < 3 ? h + 24 : h; const i = HOUR_BANDS.findIndex((b) => hh >= b[0] && hh < b[1]); if (i >= 0) n[i]++; });
    const i = n.indexOf(Math.max(...n));
    return { label: HOUR_BANDS[i][2], share: n[i] / hrs.length, sessions: n[i] };
  }

  // ---------------------------------------------------------------- consistency, mantra stats, trends
  function consistency(days, goals, sessions, events, range, today, hourOf) {
    const to = minDate(range.to, today);
    const s = sumRange(days, range.from, to);
    const dates = activeDates(days);
    const mFrom = monthStart(today);
    const idx = sessionIndex(events);
    const timed = sessions.filter((x) => x.source !== 'manual' && idx[x.id] && idx[x.id].seconds > 0 && idx[x.id].dates.some((d) => d >= range.from && d <= to));
    return {
      daysThisMonth: sumRange(days, mFrom, today).activeDays,
      daysInMonthSoFar: diffDays(mFrom, today) + 1,
      goalDays: goalDays(goals, days, range.from, to),
      currentStreak: currentStreak(dates, today),
      longestStreak: longestStreak(dates),
      avgRepsPerActiveDay: s.activeDays ? Math.round(s.reps / s.activeDays) : null,
      avgSessionSeconds: timed.length ? Math.round(timed.reduce((n, x) => n + idx[x.id].seconds, 0) / timed.length) : null,
      practiceTime: practiceTime(sessions.filter((x) => idx[x.id] && idx[x.id].count > 0), hourOf, 5),
      activeDays: s.activeDays,
    };
  }
  function mantraStats(mantraId, days, goals, today) {
    const dates = activeDates(days, mantraId);
    const all = sumRange(days, '0000-01-01', '9999-12-31', mantraId);
    const daily = goalsOn(goals, today).filter((g) => sameMantra(g.mantra_id, mantraId) && GOAL_TYPES[g.goal_type].period === 'day');
    return {
      today: repsOfDay(days.get(today), mantraId),
      week: sumRange(days, weekStart(today), today, mantraId).reps,
      month: sumRange(days, monthStart(today), today, mantraId).reps,
      lifetime: all.reps, malas: all.malas, seconds: all.seconds,
      todayGoals: daily.map((g) => goalProgress(g, days, today)),
      goalDays30: goalDays(goals, days, addDays(today, -29), today, mantraId),
      lastPracticed: dates.length ? dates[dates.length - 1] : null,
      longestStreak: longestStreak(dates),
      currentStreak: currentStreak(dates, today),
    };
  }
  // Only says something when there is enough data behind it. Returns [{ kind, text }].
  function trends(days, goals, sessions, events, today, names, hourOf) {
    const out = [];
    const a = sumRange(days, addDays(today, -6), today), b = sumRange(days, addDays(today, -13), addDays(today, -7));
    if (a.activeDays >= 3 && b.activeDays >= 3 && b.reps > 0) {
      const pct = Math.round(((a.reps - b.reps) / b.reps) * 100);
      if (pct >= 3) out.push({ kind: 'week', text: `Your average daily Jaap increased by ${pct}% compared with last week.` });
      else if (pct <= -3) out.push({ kind: 'week', text: `Your daily Jaap was ${-pct}% lighter than last week. Every naam still counts.` });
      else out.push({ kind: 'week', text: 'Your daily Jaap has been steady, much the same as last week.' });
    }
    const gd = goalDays(goals, days, monthStart(today), today);
    if (gd.total > 0 && gd.met > 0) out.push({ kind: 'sankalpa', text: `You completed your Sankalpa on ${gd.met} ${gd.met === 1 ? 'day' : 'days'} this month.` });
    const dom = diffDays(monthStart(today), today);
    const prevStart = monthStart(addDays(monthStart(today), -1));
    const prevTo = minDate(addDays(prevStart, dom), monthEnd(prevStart));
    const m1 = sumRange(days, monthStart(today), today), m0 = sumRange(days, prevStart, prevTo);
    if (m1.activeDays >= 5 && m0.activeDays >= 5 && m1.reps !== m0.reps) {
      const d = m1.reps - m0.reps;
      out.push({ kind: 'month', text: d > 0
        ? `You have chanted ${fmtNum(d)} more repetitions than at this point last month.`
        : `This month stands at ${fmtNum(m1.reps)} repetitions, with ${fmtNum(m0.reps)} at this point last month.` });
    }
    const last30 = { from: addDays(today, -29), to: today };
    const dist = distribution(days, last30);
    if (dist.length >= 2 && sumRange(days, last30.from, last30.to).activeDays >= 5 && names && names[dist[0].mantra_id]) {
      out.push({ kind: 'mantra', text: `${names[dist[0].mantra_id]} has received ${Math.round(dist[0].share * 100)}% of your Jaap over the last 30 days.` });
    }
    const idx = sessionIndex(events);
    const pt = practiceTime(sessions.filter((s) => idx[s.id] && idx[s.id].count > 0), hourOf, 7);
    if (pt && pt.share >= 0.4) out.push({ kind: 'time', text: `You most often sit for Jaap ${pt.label}.` });
    return out;
  }
  const fmtNum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // ---------------------------------------------------------------- milestones + records
  // When did the running total first reach each milestone? Derived from the events, so it stays right
  // after a session is corrected or deleted.
  function milestones(events, customCounts, mantraId) {
    const list = events.filter((e) => e.count > 0 && (!mantraId || e.mantra_id === mantraId))
      .sort((a, b) => a.local_date.localeCompare(b.local_date) || String(a.first_at || '').localeCompare(String(b.first_at || '')));
    const targets = [...new Set([...STD_MILESTONES, ...(customCounts || [])])].filter((n) => n > 0).sort((a, b) => a - b);
    const reached = {}; let total = 0, i = 0;
    for (const e of list) {
      total += e.count;
      while (i < targets.length && total >= targets[i]) { reached[targets[i]] = { date: e.local_date, at: e.last_at || null }; i++; }
    }
    const custom = new Set(customCounts || []);
    return {
      total,
      items: targets.map((n) => ({ count: n, custom: custom.has(n) && !STD_MILESTONES.includes(n), achieved: !!reached[n],
        date: reached[n] ? reached[n].date : null, at: reached[n] ? reached[n].at : null, frac: Math.min(1, total / n) })),
    };
  }
  function records(days, sessions, events) {
    let bestDay = null, bestMalaDay = null;
    for (const d of days.values()) {
      if (d.count > 0 && (!bestDay || d.count > bestDay.reps)) bestDay = { reps: d.count, date: d.date };
      const m = malasOfDay(d); if (m > 0 && (!bestMalaDay || m > bestMalaDay.malas)) bestMalaDay = { malas: m, date: d.date };
    }
    const idx = sessionIndex(events); let bestSession = null, longest = null;
    for (const s of sessions) {
      const t = idx[s.id]; if (!t) continue;
      if (t.malas > 0 && (!bestSession || t.malas > bestSession.malas)) bestSession = { malas: t.malas, reps: t.count, date: t.dates[0] || null, mantra_id: s.mantra_id };
      if (s.source !== 'manual' && t.seconds > 0 && (!longest || t.seconds > longest.seconds)) longest = { seconds: t.seconds, date: t.dates[0] || null, mantra_id: s.mantra_id };
    }
    const ls = longestStreak(activeDates(days));
    return { bestDay, bestMalaDay, bestSession, longestSession: longest, longestStreak: ls.days ? ls : null };
  }

  // ---------------------------------------------------------------- formatting
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    if (m) return `${m}m`;
    return `${s}s`;
  }
  // Reminder schedule: is `hhmm` on local day `date` (weekday `d`) due at `nowMin` minutes past local midnight?
  function reminderDue(rem, localDate, localDow, nowMin, windowMin) {
    if (!rem.enabled) return false;
    const days = rem.days_of_week || [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(localDow)) return false;
    const [h, m] = String(rem.scheduled_time).split(':').map(Number);
    const at = h * 60 + m;
    return nowMin >= at && nowMin - at < (windowMin || 60);
  }

  return {
    MALA, IDLE_CAP, STD_MILESTONES, GOAL_TYPES,
    iso, addDays, diffDays, dow, weekStart, monthStart, monthEnd, yearStart, minDate, maxDate, eachDay,
    buildDays, malasOfDay, repsOfDay, secondsOfDay, firstDate, activeDates, sumRange,
    rangeFor, currentStreak, longestStreak, overview, bucketSize, series, heatLevel, heatmap, distribution,
    goalActiveOn, goalOn, goalsOn, periodOf, goalProgress, dayGoalsMet, goalDays, planGoalChange,
    sessionTotals, sessionIndex, redistribute, applyTap, practiceTime,
    consistency, mantraStats, trends, milestones, records, fmtDuration, fmtNum, reminderDue,
  };
});
