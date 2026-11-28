// Naam Jaap — counter, My Journey analytics, goals, reminders, history, milestones.
// Loaded before the main script in index.html; it only touches the main script's helpers
// (S, LS, client, queue, esc, uid, today, fmt, toast, render …) from inside functions, at call time.
// All figures come from JaapCore over the locally cached events, so everything works offline.
(function () {
  'use strict';
  const C = window.JaapCore;
  const EMPTY = () => ({ uid: null, mantras: [], sessions: [], events: [], goals: [], reminders: [], milestones: [], logs: [], settings: null });
  const J = {
    data: null, days: null, loaded: false, pulling: false, dirty: false, counter: null, form: null, timer: null, saveTimer: null, wake: null, recover: null,
    ui: { sec: 'home', range: '30', custom: { from: '', to: '' }, metric: 'reps', sel: null, barsKey: '', hist: { mantra: '', from: '', to: '' }, histN: 30, lastHtml: '' },
  };
  const PRESETS = [
    ['radhe', 'Radhe', 'Radha Bhakti', 'The name of Radha Rani, chanted for tender, loving devotion.'],
    ['harekrishna', 'Hare Krishna', 'Maha Mantra', 'The sixteen-name Maha Mantra of Krishna and Rama.'],
    ['jaishreeram', 'Jai Shree Ram', 'Ram Bhakti', 'A salutation to Lord Ram, for courage and steadiness.'],
    ['omnamahshivaya', 'Om Namah Shivaya', 'Panchakshari Mantra', 'The five-syllable mantra of Shiva, for inner stillness.'],
    ['ram', 'Ram', 'Ram Naam', 'The single name, Ram, repeated with each breath.'],
    ['omnamonarayanaya', 'Om Namo Narayanaya', 'Ashtakshari Mantra', 'The eight-syllable mantra of Narayana.'],
    ['hanumate', 'Om Shri Hanumate Namah', 'Hanuman Mantra', 'A salutation to Hanumanji, for strength and protection.'],
    ['ganapataye', 'Om Gam Ganapataye Namah', 'Ganesha Mantra', 'Chanted before beginnings, to remove obstacles.'],
    ['shriramjairam', 'Shri Ram Jai Ram Jai Jai Ram', 'Taraka Mantra', 'The thirteen-syllable Ram mantra.'],
    ['vasudevaya', 'Om Namo Bhagavate Vasudevaya', 'Dwadashakshari Mantra', 'The twelve-syllable mantra of Vishnu.'],
    ['durgayai', 'Om Dum Durgayai Namah', 'Durga Mantra', 'A salutation to Durga Maa, for protection and resolve.'],
    ['gayatri', 'Gayatri Mantra', 'Savitri Mantra', 'One repetition for each full recitation of the Gayatri.'],
  ];
  const TYPES = {
    scheduled: ['Scheduled reminder', 'A notification at the time you choose.'],
    incomplete_goal: ['Incomplete goal', 'Only if today\'s daily goal is not yet complete at this time.'],
    resume: ['Resume practice', 'Only if a session was left unfinished.'],
    daily_summary: ['Daily summary', 'Today\'s repetitions, malas and goal progress.'],
    weekly_reflection: ['Weekly reflection', 'Once a week: your last seven days in brief.'],
  };
  const TEMPLATES = [
    ['Morning Jaap', 'scheduled', '06:00'], ['Afternoon Jaap', 'scheduled', '12:30'], ['Evening Jaap', 'scheduled', '19:00'], ['Before Sleep', 'scheduled', '21:30'],
    ['Goal check-in', 'incomplete_goal', '20:00'], ['Resume practice', 'resume', '18:00'], ['Daily summary', 'daily_summary', '21:00'], ['Weekly reflection', 'weekly_reflection', '20:00'],
  ];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const GOAL_HINT = { daily_reps: 'repetitions each day', daily_malas: 'malas each day', weekly_malas: 'malas each week, Monday to Sunday', monthly_reps: 'repetitions each calendar month' };

  // ---------------------------------------------------------------- data
  function D() {
    if (!J.data) {
      J.data = Object.assign(EMPTY(), LS.get('jaap', {}));
      const live = LS.get('jaapLive', null);
      if (live && live.session) {                     // the app closed mid-count: nothing tapped is lost
        if (!J.data.sessions.some((s) => s.id === live.session.id)) J.data.sessions.push(live.session);
        (live.buckets || []).forEach((b) => {
          const i = J.data.events.findIndex((e) => e.session_id === b.session_id && e.local_date === b.local_date);
          if (i < 0) J.data.events.push(b); else if (b.count >= J.data.events[i].count) J.data.events[i] = b;
        });
        J.recover = live;
      }
    }
    return J.data;
  }
  const idx = () => J.days || (J.days = C.buildDays(D().events));
  function touch(now) {
    J.days = null;
    clearTimeout(J.saveTimer);
    if (now) LS.set('jaap', D()); else J.saveTimer = setTimeout(() => LS.set('jaap', D()), 500);
  }
  const num = C.fmtNum, dur = (sec) => (sec > 0 ? C.fmtDuration(sec) : '–');
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } };
  const hourOf = (isoStr) => new Date(isoStr).getHours();
  const tm = (isoStr) => new Date(isoStr).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const localDate = (isoStr) => C.iso(new Date(isoStr));
  const mantra = (id) => D().mantras.find((m) => m.id === id);
  const mname = (id) => (mantra(id) || {}).name || 'Mantra';
  const liveMantras = () => D().mantras.filter((m) => !m.archived).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
  const eventsOf = (sid) => D().events.filter((e) => e.session_id === sid);
  const pick = (o, keys) => { const r = {}; keys.forEach((k) => { r[k] = o[k] === undefined ? null : o[k]; }); return r; };
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const dlong = (d) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dshort = (d) => fmt(d, { day: 'numeric', month: 'short' });

  // ---------------------------------------------------------------- sync (through Sankalp's offline outbox)
  const up = (table, row, key, conflict) => queue({ t: 'upsert', table, row, key, conflict });
  const syncMantra = (m) => up('jaap_mantras', pick(m, ['id', 'name', 'subtitle', 'preset_key', 'archived', 'sort']), 'jm:' + m.id);
  const syncSession = (s) => up('jaap_sessions', pick(s, ['id', 'mantra_id', 'started_at', 'ended_at', 'status', 'tz', 'source', 'edited_at']), 'js:' + s.id);
  const syncEvent = (e) => up('jaap_events', pick(e, ['session_id', 'local_date', 'mantra_id', 'count', 'seconds', 'first_at', 'last_at']), 'je:' + e.session_id + ':' + e.local_date, 'session_id,local_date');
  const syncGoal = (g) => up('jaap_goals', pick(g, ['id', 'mantra_id', 'goal_type', 'target_count', 'effective_from', 'effective_until']), 'jg:' + g.id);
  const syncReminder = (r) => up('jaap_reminders', Object.assign(pick(r, ['id', 'mantra_id', 'reminder_type', 'name', 'scheduled_time', 'timezone', 'days_of_week', 'enabled', 'target_count', 'sound', 'snooze_minutes']), { updated_at: new Date().toISOString() }), 'jr:' + r.id);
  const del = (table, id) => queue({ t: 'delete', table, id });

  async function pull() {
    const c = client();
    if (!c || !S.user || !navigator.onLine || J.pulling || J.counter) return;
    const d = D();
    if (d.uid && d.uid !== S.user.id) { reset(); }
    if (J.recover) { const l = J.recover; J.recover = null; syncSession(l.session); (l.buckets || []).forEach(syncEvent); LS.set('jaapLive', null); touch(true); }
    if (S.outbox.length || J.dirty) return;
    J.pulling = true;
    try {
      const all = async (table, o1, o2) => {
        let out = [], from = 0;
        for (;;) {
          let q = c.from(table).select('*').order(o1); if (o2) q = q.order(o2);
          const r = await q.range(from, from + 999); if (r.error) throw r.error;
          out = out.concat(r.data); if (r.data.length < 1000) break; from += 1000;
        }
        return out;
      };
      const [mantras, sessions, events, goals, reminders, milestones, logs, settings] = await Promise.all([
        all('jaap_mantras', 'created_at', 'id'), all('jaap_sessions', 'started_at', 'id'), all('jaap_events', 'local_date', 'session_id'),
        all('jaap_goals', 'effective_from', 'id'), all('jaap_reminders', 'scheduled_time', 'id'), all('jaap_milestones', 'milestone_count', 'id'),
        c.from('jaap_delivery_logs').select('*').order('scheduled_for', { ascending: false }).limit(12).then((r) => { if (r.error) throw r.error; return r.data; }),
        c.from('jaap_settings').select('*').maybeSingle().then((r) => { if (r.error) throw r.error; return r.data; }),
      ]);
      if (S.outbox.length || J.dirty || J.counter) return;      // something was tapped meanwhile; next pull catches up
      const next = { uid: S.user.id, mantras, sessions, events, goals, reminders, milestones, logs, settings };
      const same = JSON.stringify(next) === JSON.stringify(J.data);
      J.data = next; J.loaded = true; if (!same) touch(true);
      followTimeZone(); reconcileMilestones(false);
      if (!same && (S.tab === 'jaap' || S.tab === 'today') && !J.form && !S.form && !S.reader) render();
    } catch (e) { console.warn('jaap pull', e); } finally { J.pulling = false; }
  }
  function reset() {
    J.data = EMPTY(); J.days = null; J.loaded = false; J.recover = null; J.counter = null;
    LS.set('jaap', J.data); LS.set('jaapLive', null);
  }
  // Travelling, or the clocks changed zone: reminder times keep meaning "6:00 where I am".
  function followTimeZone() {
    const z = tz(), moved = D().reminders.filter((r) => r.timezone !== z);
    if (!moved.length) return;
    moved.forEach((r) => { r.timezone = z; syncReminder(r); });
    touch(true); toast(`Reminder times now follow ${z.replace(/_/g, ' ')}`, 3600);
  }

  // ---------------------------------------------------------------- milestones
  const customCounts = () => D().milestones.filter((m) => m.is_custom && !m.mantra_id).map((m) => m.milestone_count);
  function reconcileMilestones(announce) {
    if (!S.user) return [];
    const d = D(), ms = C.milestones(d.events, customCounts()), fresh = [];
    ms.items.forEach((it) => {
      const row = d.milestones.find((m) => !m.mantra_id && m.milestone_count === it.count);
      if (it.achieved && (!row || !row.achieved_at)) {
        const r = row || { id: uid(), mantra_id: null, milestone_count: it.count, is_custom: false, created_at: new Date().toISOString() };
        r.achieved_at = it.at || it.date + 'T12:00:00Z';
        if (!row) d.milestones.push(r);
        up('jaap_milestones', Object.assign({ user_id: S.user.id }, pick(r, ['id', 'mantra_id', 'milestone_count', 'is_custom', 'achieved_at'])), 'jms:' + it.count, 'user_id,mantra_id,milestone_count');
        fresh.push(it.count);
      } else if (!it.achieved && row && row.achieved_at) {       // a correction took the total back below it
        if (row.is_custom) { row.achieved_at = null; up('jaap_milestones', Object.assign({ user_id: S.user.id }, pick(row, ['id', 'mantra_id', 'milestone_count', 'is_custom', 'achieved_at'])), 'jms:' + it.count, 'user_id,mantra_id,milestone_count'); }
        else { d.milestones = d.milestones.filter((m) => m !== row); del('jaap_milestones', row.id); }
      }
    });
    if (fresh.length) touch(true);
    if (announce && fresh.length) { const top = Math.max(...fresh); setTimeout(() => { celebrate(`${num(top)} repetitions`, 'A milestone on your journey'); }, 500); }
    return fresh;
  }

  // ---------------------------------------------------------------- counter
  function begin(mantraId) {
    const d = D(); if (!mantra(mantraId)) return;
    let s = d.sessions.find((x) => x.status === 'active' && x.mantra_id === mantraId);
    const isNew = !s;
    if (!s) { s = { id: uid(), mantra_id: mantraId, started_at: new Date().toISOString(), ended_at: null, status: 'active', tz: tz(), source: 'counter', edited_at: null }; d.sessions.push(s); }
    J.counter = { id: s.id, lastTap: 0, onServer: !isNew, dirtyDates: new Set() };
    LS.set('jaapLast', mantraId);
    closeSheet(); openCounter();
  }
  const cSession = () => D().sessions.find((s) => s.id === J.counter.id);
  function beads() {
    let h = '';
    for (let i = 0; i < 108; i++) {
      const a = ((i + 0.5) / 108) * 2 * Math.PI - Math.PI / 2;
      h += `<circle class="bead" cx="${(100 + 92 * Math.cos(a)).toFixed(2)}" cy="${(100 + 92 * Math.sin(a)).toFixed(2)}" r="2.35"/>`;
    }
    return `<svg viewBox="0 0 200 200" aria-hidden="true">${h}<circle class="meru" cx="100" cy="3.6" r="2.9"/></svg>`;
  }
  function openCounter() {
    const s = cSession(), layer = document.getElementById('layer');
    layer.innerHTML = `<div class="jp-counter" id="jp-counter">
      <header><button class="jp-ic" data-jact="c-min" aria-label="Back"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="mid"><div class="a" id="jp-ca"></div><div class="b" id="jp-cb"></div></div>
        <button class="jp-fin" data-jact="c-finish">✓ Finish</button></header>
      <div class="stage"><div class="name">${esc(mname(s.mantra_id))}</div><div class="sub" id="jp-sub"></div>
        <div class="jp-mala" id="jp-mala" role="button" aria-label="Count one repetition">${beads()}
          <div class="disc"><div class="lbl">Bead</div><div class="num" id="jp-num">0</div><div class="of">of 108</div><div class="hint" id="jp-hint">Tap to count</div></div></div></div>
      <footer><span class="jp-chip" id="jp-sync"></span><button class="jp-undo" data-jact="c-undo" id="jp-undo">Undo</button><span class="jp-chip" id="jp-goal"></span></footer></div>`;
    const el = document.getElementById('jp-mala');
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(1); });
    el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(1); } });
    J.beadEls = [...el.querySelectorAll('.bead')];
    paintCounter(false);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { J.wake = w; }).catch(() => {});
  }
  function paintCounter(pop) {
    if (!J.counter || !document.getElementById('jp-counter')) return;
    const s = cSession(), t = C.sessionTotals(s, D().events), td = today();
    const pos = t.count > 0 && t.count % 108 === 0 ? 108 : t.count % 108;
    const n = document.getElementById('jp-num'); n.textContent = pos;
    if (pop) { n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
    J.beadEls.forEach((b, i) => { b.setAttribute('class', 'bead' + (i < pos ? (i === pos - 1 ? ' on cur' : ' on') : '')); });
    document.getElementById('jp-mala').classList.toggle('full', pos === 108);
    document.getElementById('jp-ca').textContent = t.count ? `${plural(t.count, 'repetition')}` : 'Your Jaap';
    document.getElementById('jp-cb').textContent = t.count ? `${plural(t.malas, 'mala')} this session${t.seconds >= 60 ? ' · ' + dur(t.seconds) : ''}` : 'Take a slow, deep breath';
    document.getElementById('jp-hint').textContent = t.count ? (pos === 108 ? 'Mala complete' : `${108 - pos} to complete this mala`) : 'Tap to count';
    document.getElementById('jp-undo').disabled = !t.count;
    const day = idx().get(td), reps = C.repsOfDay(day, s.mantra_id);
    document.getElementById('jp-sub').textContent = t.count ? `Today · ${plural(reps, 'repetition')} of ${mname(s.mantra_id)}` : 'Tap the mala once for each naam you chant.';
    const g = C.goalsOn(D().goals, td).filter((x) => C.GOAL_TYPES[x.goal_type].period === 'day' && (x.mantra_id === s.mantra_id || !x.mantra_id))
      .sort((a, b) => (a.mantra_id ? 0 : 1) - (b.mantra_id ? 0 : 1))[0];
    const ge = document.getElementById('jp-goal');
    if (g) { const p = C.goalProgress(g, idx(), td); ge.textContent = `Daily goal: ${num(p.done)} / ${num(p.target)}${p.unit === 'malas' ? ' malas' : ''}`; ge.style.visibility = ''; }
    else ge.style.visibility = 'hidden';
    paintSync();
  }
  function paintSync() { const el = document.getElementById('jp-sync'); if (el) el.innerHTML = J.dirty ? '<span class="dot wait"></span>Saving' : syncHtml(); }
  function tap(delta) {
    if (!J.counter) return;
    const d = D(), s = cSession(), now = Date.now(), date = today();
    let b = d.events.find((e) => e.session_id === s.id && e.local_date === date);
    if (delta < 0) {
      if (!b || !b.count) b = eventsOf(s.id).filter((e) => e.count > 0).sort((x, y) => y.local_date.localeCompare(x.local_date))[0];
      if (!b) return;
    } else if (!b) { b = { session_id: s.id, local_date: date, mantra_id: s.mantra_id, count: 0, seconds: 0, first_at: null, last_at: null }; d.events.push(b); }
    C.applyTap(b, delta, now, J.counter.lastTap);
    if (delta > 0) J.counter.lastTap = now;
    J.counter.dirtyDates.add(b.local_date); J.dirty = true; J.days = null;
    LS.set('jaapLive', { session: s, buckets: eventsOf(s.id) });
    const total = C.sessionTotals(s, d.events).count;
    if (delta > 0 && total % 108 === 0) {
      if (navigator.vibrate) navigator.vibrate([40, 70, 40, 70, 120]);
      flash(`${plural(total / 108, 'mala')} complete`);
    } else if (navigator.vibrate) navigator.vibrate(delta > 0 ? 12 : [6, 40, 6]);
    paintCounter(delta > 0);
    if (!J.timer) J.timer = setTimeout(commitLive, 1500);
  }
  function flash(text) {
    const host = document.getElementById('jp-counter'); if (!host) return;
    host.querySelectorAll('.jp-flash').forEach((x) => x.remove());
    const f = document.createElement('div'); f.className = 'jp-flash'; f.textContent = text; host.appendChild(f); setTimeout(() => f.remove(), 2500);
  }
  // push what was tapped into the offline outbox (absolute counts, so a retry can never double-count)
  function commitLive() {
    clearTimeout(J.timer); J.timer = null;
    if (!J.counter || !J.dirty) { paintSync(); return; }
    const s = cSession();
    if (!J.counter.onServer) { syncSession(s); J.counter.onServer = true; }
    eventsOf(s.id).filter((e) => J.counter.dirtyDates.has(e.local_date)).forEach(syncEvent);
    J.counter.dirtyDates.clear(); J.dirty = false; touch(true); LS.set('jaapLive', null); paintSync();
  }
  function leaveCounter() {
    if (J.wake) { J.wake.release().catch(() => {}); J.wake = null; }
    J.counter = null; J.beadEls = null; document.getElementById('layer').innerHTML = '';
  }
  function finishSession(id, quiet) {
    const d = D(), s = d.sessions.find((x) => x.id === id); if (!s) return null;
    const t = C.sessionTotals(s, d.events);
    if (!t.count) { d.sessions = d.sessions.filter((x) => x !== s); d.events = d.events.filter((e) => e.session_id !== id); del('jaap_sessions', id); touch(true); return null; }
    s.status = 'finished'; s.ended_at = new Date(Math.max(Date.now(), Date.parse(s.started_at))).toISOString();
    const last = eventsOf(id).map((e) => e.last_at).filter(Boolean).sort().pop();
    if (quiet && last) s.ended_at = last;                     // finished later from the list: it ended at the last repetition
    syncSession(s); touch(true);
    return t;
  }
  function finishCounter() {
    commitLive();
    const s = cSession(), onServer = J.counter.onServer, id = s.id, mid = s.mantra_id;
    const t = C.sessionTotals(s, D().events);
    if (!t.count && !onServer) { D().sessions = D().sessions.filter((x) => x.id !== id); touch(true); leaveCounter(); render(); return; }
    finishSession(id); leaveCounter(); render();
    if (!t.count) return;
    const fresh = reconcileMilestones(true);
    const td = today(), goals = C.goalsOn(D().goals, td).filter((g) => C.GOAL_TYPES[g.goal_type].period === 'day' && (!g.mantra_id || g.mantra_id === mid)).map((g) => C.goalProgress(g, idx(), td));
    sheet(`<div class="eyebrow">Session complete</div><h3>${esc(mname(mid))}</h3>
      <div class="jp-sum"><div><div class="v">${num(t.count)}</div><div class="l">repetitions</div></div><div><div class="v">${num(t.malas)}</div><div class="l">${t.malas === 1 ? 'mala' : 'malas'}</div></div><div><div class="v">${dur(t.seconds)}</div><div class="l">practice time</div></div></div>
      ${goals.map((p) => `<div class="jp-note" style="margin-bottom:6px">${goalLine(p)}</div>${track(p.frac, p.met)}`).join('<div style="height:10px"></div>')}
      ${fresh.length ? `<div class="jp-note" style="margin-top:14px">You have reached <b>${num(Math.max(...fresh))}</b> lifetime repetitions.</div>` : ''}
      <button class="btn primary block" style="margin-top:20px" data-jact="close">Done</button>`);
  }
  const goalLine = (p) => {
    const who = p.goal.mantra_id ? mname(p.goal.mantra_id) : 'all mantras';
    const what = C.GOAL_TYPES[p.type].label.toLowerCase();
    return p.met ? `<b>${esc(who)}</b> · ${what} complete (${num(p.done)} of ${num(p.target)})` : `<b>${esc(who)}</b> · ${num(p.done)} of ${num(p.target)} ${p.unit === 'malas' ? 'malas' : 'repetitions'} ${p.type.startsWith('daily') ? 'today' : p.type.startsWith('weekly') ? 'this week' : 'this month'}`;
  };
  const track = (frac, done) => `<div class="jp-track${done ? ' done' : ''}"><i style="width:${Math.round(Math.min(1, frac) * 100)}%"></i></div>`;

  // ---------------------------------------------------------------- sheets
  function sheet(html) { document.getElementById('layer').innerHTML = `<div class="sheet-bg" data-jact="bg"><div class="sheet"><div class="grab"></div>${html}</div></div>`; }
  function closeSheet() { if (J.counter) return; J.form = null; document.getElementById('layer').innerHTML = ''; }
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
  const mantraOptions = (cur, anyLabel) => (anyLabel ? opt('', anyLabel, cur) : '') + D().mantras.filter((m) => !m.archived || m.id === cur).map((m) => opt(m.id, m.name, cur)).join('');

  // ---------------------------------------------------------------- views
  const NAV = [['home', 'Jaap'], ['journey', 'My Journey'], ['goals', 'Goals'], ['reminders', 'Reminders'], ['history', 'History']];
  function view() {
    D();
    const sec = J.ui.sec;
    const body = sec === 'journey' ? secJourney() : sec === 'goals' ? secGoals() : sec === 'reminders' ? secReminders() : sec === 'history' ? secHistory() : secHome();
    return `<div class="jp"><div class="jp-nav">${NAV.map(([k, l]) => `<button class="${sec === k ? 'on' : ''}" data-jact="sec" data-id="${k}">${l}</button>`).join('')}</div>${body}</div>`;
  }
  function insights() {
    const td = today(), days = idx(), reps = C.repsOfDay(days.get(td));
    const goals = C.goalsOn(D().goals, td).filter((g) => C.GOAL_TYPES[g.goal_type].period === 'day').map((g) => C.goalProgress(g, days, td));
    const pct = goals.length ? Math.round((goals.reduce((n, p) => n + p.frac, 0) / goals.length) * 100) : null;
    const streak = C.currentStreak(C.activeDates(days), td);
    return { reps, pct, streak, malas: C.malasOfDay(days.get(td)) };
  }
  const three = (i) => `<div class="jp-three"><div><div class="v">${num(i.reps)}</div><div class="l">Today's Jaap</div></div>
    <div><div class="v">${i.pct === null ? '–' : i.pct + '%'}</div><div class="l">${i.pct === null ? 'No daily goal yet' : 'Daily goal'}</div></div>
    <div><div class="v">${i.streak}</div><div class="l">${i.streak === 1 ? 'day streak' : 'day streak'}</div></div></div>`;
  // Three compact insights for Sankalp's Today screen; the charts stay inside My Journey.
  function homeCard() {
    D();
    const ms = liveMantras();
    if (!ms.length) return `<h2>Naam Jaap</h2><div class="card"><div class="muted" style="font-size:14.5px;line-height:1.5">Count your mantra one bead at a time, and see your practice grow.</div>
      <div class="actions"><button class="btn sm primary" data-jact="goto" data-id="home">Choose a mantra</button></div></div>`;
    const last = LS.get('jaapLast', null), m = ms.find((x) => x.id === last) || ms[0];
    return `<h2>Naam Jaap</h2><div class="card">${three(insights())}
      <div class="actions"><button class="btn sm primary" data-jact="begin" data-id="${m.id}">Begin ${esc(m.name)}</button><button class="btn sm line" data-jact="goto" data-id="journey">My Journey</button></div></div>`;
  }
  function secHome() {
    const d = D(), td = today(), days = idx(), ms = liveMantras();
    if (!ms.length) return `<div class="card jp-empty"><div class="eyebrow">Step 01</div><div class="big" style="margin-top:8px">Choose your mantra.</div>
      <p>Pick one or more. You can change them any time, and your count always stays with you.</p><button class="btn primary" data-jact="add-mantra">Choose a mantra</button></div>`;
    let h = '';
    d.sessions.filter((s) => s.status === 'active').forEach((s) => {
      const t = C.sessionTotals(s, d.events); if (!t.count) return;
      h += `<div class="banner"><b>${esc(mname(s.mantra_id))} · unfinished session</b>${plural(t.count, 'repetition')} so far, begun ${localDate(s.started_at) === td ? 'at ' + tm(s.started_at) : 'on ' + dshort(localDate(s.started_at))}.
        <div class="actions"><button class="btn sm primary" data-jact="begin" data-id="${s.mantra_id}">Resume</button><button class="btn sm line" data-jact="finish-quiet" data-id="${s.id}">Finish it</button></div></div>`;
    });
    h += `<div class="card">${three(insights())}</div><h2>Your mantras</h2>`;
    ms.forEach((m) => {
      const reps = C.repsOfDay(days.get(td), m.id);
      const g = C.goalsOn(d.goals, td).filter((x) => x.mantra_id === m.id && C.GOAL_TYPES[x.goal_type].period === 'day').map((x) => C.goalProgress(x, days, td))[0];
      h += `<div class="card"><div class="jp-mantra"><div class="t" data-jact="begin" data-id="${m.id}" role="button"><div class="n">${esc(m.name)}</div>${m.subtitle ? `<div class="s">${esc(m.subtitle)}</div>` : ''}
        <div class="p">${reps ? `Today · ${plural(reps, 'repetition')} · ${plural(Math.floor(reps / 108), 'mala')}` : 'Not yet today'}${g ? ` · goal ${num(g.target)} ${g.unit === 'malas' ? (g.target === 1 ? 'mala' : 'malas') : ''}` : ''}</div>${g ? track(g.frac, g.met) : ''}</div>
        <button class="jp-more" data-jact="mantra" data-id="${m.id}" aria-label="Options">⋯</button>
        <button class="jp-go" data-jact="begin" data-id="${m.id}" aria-label="Begin ${esc(m.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div></div>`;
    });
    return h + `<button class="btn line block" data-jact="add-mantra">+ Add a mantra</button>`;
  }

  // ---- My Journey
  const RANGES = [['today', 'Today'], ['7', '7 Days'], ['30', '30 Days'], ['90', '90 Days'], ['year', 'This Year'], ['all', 'All Time'], ['custom', 'Custom']];
  const curRange = () => C.rangeFor(J.ui.range, today(), C.firstDate(idx()), J.ui.custom);
  const rangeLabel = (r) => r.from === r.to ? dshort(r.from) : `${dshort(r.from)} – ${fmt(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const bucketTitle = (b, size) => size === 'day' ? dlong(b.from) : size === 'week' ? `${dshort(b.from)} – ${dshort(b.to)}` : fmt(b.from, { month: 'long', year: 'numeric' });
  const metricVal = (v) => J.ui.metric === 'time' ? dur(v) : num(v);
  function detailHtml(b, size) {
    if (!b) return `<div class="jp-detail muted" id="jp-detail">Tap a bar to see the date, the mantras and the time spent.</div>`;
    const rows = Object.keys(b.byMantra).sort((x, y) => b.byMantra[y].count - b.byMantra[x].count).map((id) => { const m = b.byMantra[id];
      return `<div class="row"><span>${esc(mname(id))}</span><span>${num(m.count)} · ${plural(m.malas, 'mala')}${m.seconds ? ' · ' + dur(m.seconds) : ''}</span></div>`; }).join('');
    return `<div class="jp-detail" id="jp-detail"><div class="d">${bucketTitle(b, size)}</div>
      ${b.reps ? `<div class="jp-kv"><span><b>${num(b.reps)}</b> repetitions</span><span><b>${num(b.malas)}</b> ${b.malas === 1 ? 'mala' : 'malas'}</span><span><b>${dur(b.seconds)}</b> practice</span></div>${rows}
      ${size === 'day' ? `<div class="actions" style="margin-top:8px"><button class="btn sm line" data-jact="day" data-id="${b.from}">Open this day</button></div>` : ''}` : `<div class="muted" style="margin-top:4px">No Jaap recorded${size === 'day' ? ' on this day' : ''}.</div>`}</div>`;
  }
  function secJourney() {
    const d = D(), td = today(), days = idx();
    if (!d.events.some((e) => e.count > 0)) return `<div class="card jp-empty"><div class="big">Your journey begins with the first naam.</div>
      <p>Once you have counted a few repetitions, your totals, calendar and trends will appear here.</p><button class="btn primary" data-jact="sec" data-id="home">Begin Jaap</button></div>`;
    const r = curRange(), o = C.overview(days, r, td);
    let h = `<div class="jp-range">${RANGES.map(([k, l]) => `<button class="${J.ui.range === k ? 'on' : ''}" data-jact="range" data-id="${k}">${l}</button>`).join('')}</div>`;
    if (J.ui.range === 'custom') h += `<div class="jp-custom"><div><label>From</label><input type="date" data-jf="cfrom" max="${td}" value="${esc(J.ui.custom.from || r.from)}"></div><div><label>To</label><input type="date" data-jf="cto" max="${td}" value="${esc(J.ui.custom.to || r.to)}"></div></div>`;
    h += `<div class="h2sub" style="margin-top:10px">${rangeLabel(r)}</div>
      <div class="jp-tiles">
        <div class="jp-tile"><div class="eyebrow">Total Jaap</div><div class="v">${num(o.reps)}</div><div class="s">repetitions, all mantras</div></div>
        <div class="jp-tile"><div class="eyebrow">Total Malas</div><div class="v">${num(o.malas)}</div><div class="s">completed rounds of 108</div></div>
        <div class="jp-tile"><div class="eyebrow">Practice Time</div><div class="v">${dur(o.seconds)}</div><div class="s">in counted sessions</div></div>
        <div class="jp-tile"><div class="eyebrow">Current Streak</div><div class="v">${o.streak}<small>${o.streak === 1 ? 'day' : 'days'}</small></div><div class="s">${o.streak ? 'consecutive days of practice' : 'begins with today\'s Jaap'}</div></div>
      </div>`;
    // daily chart
    const se = C.series(days, r, J.ui.metric), key = [r.from, r.to, J.ui.metric].join('|'), animate = J.ui.barsKey !== key; J.ui.barsKey = key;
    if (J.ui.range === 'today' && !J.ui.sel) J.ui.sel = td;
    const n = se.buckets.length, step = Math.max(1, Math.ceil(n / 6));
    const lab = (b) => se.size === 'month' ? fmt(b.from, { month: 'short', year: '2-digit' }) : dshort(b.from);
    h += `<h2>${se.size === 'day' ? 'Daily Jaap' : se.size === 'week' ? 'Jaap by week' : 'Jaap by month'}</h2>
      <div class="card"><div class="row" style="justify-content:space-between;gap:8px"><div class="seg">${[['reps', 'Repetitions'], ['malas', 'Malas'], ['time', 'Time']].map(([k, l]) => `<button class="${J.ui.metric === k ? 'on' : ''}" data-jact="metric" data-id="${k}">${l}</button>`).join('')}</div></div>
      <div class="jp-chart"><div class="jp-ymax">${se.max ? 'peak ' + metricVal(se.max) : ''}</div><div class="scroll" id="jp-scroll"><div style="min-width:${n > 34 ? n * 12 : 0}px">
        <div class="jp-bars">${se.buckets.map((b) => { const pc = se.max ? Math.max(b.value ? 2 : 0, (b.value / se.max) * 100) : 0;
          return `<div class="jp-bar${b.value ? ' has' : ''}${J.ui.sel === b.key ? ' sel' : ''}" data-jact="bar" data-id="${b.key}" title="${bucketTitle(b, se.size)}: ${metricVal(b.value)}"><i ${animate ? `data-h="${pc.toFixed(1)}"` : `style="height:${pc.toFixed(1)}%"`}></i></div>`; }).join('')}</div>
        <div class="jp-axis">${se.buckets.map((b, i) => `<span>${(i % step === 0 && i <= n - step / 2) || n === 1 ? `<b>${lab(b)}</b>` : ''}</span>`).join('')}</div></div></div></div>
      ${detailHtml(se.buckets.find((b) => b.key === J.ui.sel), se.size)}</div>`;
    // calendar
    const hf = C.maxDate(C.minDate(r.from, C.addDays(r.to, -146)), C.addDays(r.to, -1095)), hm2 = C.heatmap(days, hf, r.to);
    let prevM = '';
    h += `<h2>Practice calendar</h2><div class="h2sub">Each square is a day. Deeper gold means more Jaap. Tap a day to open it.</div>
      <div class="card"><div class="jp-heat" id="jp-heat"><div class="grid">${hm2.weeks.map((w) => { const first = w.find((c) => c.inRange) || w[0], mo = first.date.slice(0, 7), show = mo !== prevM; prevM = mo;
        return `<div class="m">${show ? fmt(first.date, { month: 'short' }) : ''}</div>` + w.map((c) => `<button class="c${c.level < 0 ? ' out' : c.level ? ' l' + c.level : ''}${c.date === td ? ' today' : ''}" ${c.level < 0 ? 'tabindex="-1"' : `data-jact="day" data-id="${c.date}" title="${dshort(c.date)}: ${num(c.count)}"`}></button>`).join(''); }).join('')}</div></div>
      <div class="jp-legend">Less <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> More</div></div>`;
    // mantras
    const dist = C.distribution(days, r);
    h += `<h2>By mantra</h2><div class="card">`;
    if (dist.length) h += `<div class="eyebrow">Share of repetitions · ${rangeLabel(r)}</div><div class="jp-dist">${dist.map((x) => `<div class="r"><div class="t"><span>${esc(mname(x.mantra_id))}</span><span>${num(x.reps)} · ${Math.round(x.share * 100)}%</span></div>${track(x.share / dist[0].share * 1, false)}</div>`).join('')}</div>`;
    else h += `<div class="muted" style="font-size:14px">No Jaap in this period.</div>`;
    h += `</div><div class="card">`;
    d.mantras.filter((m) => !m.archived || d.events.some((e) => e.mantra_id === m.id && e.count > 0)).forEach((m) => {
      const s = C.mantraStats(m.id, days, d.goals, td), g = s.todayGoals[0];
      h += `<details class="jp-m"${J.ui.openMantra === m.id ? ' open' : ''} data-id="${m.id}"><summary><span class="n">${esc(m.name)}</span><span class="a">${num(s.lifetime)} lifetime ›</span></summary>
        <div class="jp-stats">
          <div><div class="l">Today</div><div class="v">${num(s.today)}</div></div><div><div class="l">This week</div><div class="v">${num(s.week)}</div></div>
          <div><div class="l">This month</div><div class="v">${num(s.month)}</div></div><div><div class="l">Lifetime</div><div class="v">${num(s.lifetime)}</div></div>
          <div><div class="l">Completed malas</div><div class="v">${num(s.malas)}</div></div><div><div class="l">Total practice time</div><div class="v">${s.seconds ? dur(s.seconds) : '–'}</div></div>
          <div><div class="l">Daily target today</div><div class="v">${g ? `${num(g.done)} / ${num(g.target)} <small>${g.unit === 'malas' ? 'malas' : 'reps'}</small>` : '<small>No daily goal</small>'}</div></div>
          <div><div class="l">Target met, last 30 days</div><div class="v">${s.goalDays30.total ? `${s.goalDays30.met} of ${s.goalDays30.total} <small>days</small>` : '<small>No daily goal</small>'}</div></div>
          <div><div class="l">Last practised</div><div class="v">${s.lastPracticed ? (s.lastPracticed === td ? 'Today' : dshort(s.lastPracticed)) : '–'}</div></div>
          <div><div class="l">Longest streak</div><div class="v">${s.longestStreak.days ? `${s.longestStreak.days} <small>${s.longestStreak.days === 1 ? 'day' : 'days'}</small>` : '–'}</div></div>
        </div></details>`;
    });
    h += `</div>`;
    // consistency
    const cs = C.consistency(days, d.goals, d.sessions, d.events, r, td, hourOf);
    h += `<h2>Consistency</h2><div class="card"><div class="jp-stats" style="margin-top:0">
      <div><div class="l">Days practised this month</div><div class="v">${cs.daysThisMonth} <small>of ${cs.daysInMonthSoFar} so far</small></div></div>
      <div><div class="l">Days with goals complete</div><div class="v">${cs.goalDays.pct === null ? '<small>Set a daily goal to see this</small>' : `${cs.goalDays.pct}% <small>${cs.goalDays.met} of ${cs.goalDays.total}</small>`}</div></div>
      <div><div class="l">Current streak</div><div class="v">${cs.currentStreak} <small>${cs.currentStreak === 1 ? 'day' : 'days'}</small></div></div>
      <div><div class="l">Longest streak</div><div class="v">${cs.longestStreak.days} <small>${cs.longestStreak.days === 1 ? 'day' : 'days'}</small></div></div>
      <div><div class="l">Average on days you practised</div><div class="v">${cs.avgRepsPerActiveDay === null ? '–' : num(cs.avgRepsPerActiveDay)}</div></div>
      <div><div class="l">Average session</div><div class="v">${cs.avgSessionSeconds === null ? '–' : dur(cs.avgSessionSeconds)}</div></div>
      <div style="grid-column:1/-1"><div class="l">When you usually practise</div><div class="v">${cs.practiceTime ? `Most often ${cs.practiceTime.label}` : '<small>Shown after a few more sessions</small>'}</div></div>
    </div></div>`;
    // trends
    const names = {}; d.mantras.forEach((m) => { names[m.id] = m.name; });
    const tr = C.trends(days, d.goals, d.sessions, d.events, td, names, hourOf);
    h += `<h2>Practice trends</h2><div class="card">${tr.length ? tr.map((x) => `<div class="jp-insight"><div>${esc(x.text)}</div></div>`).join('') : `<div class="muted" style="font-size:14.5px;line-height:1.5">Trends appear once there are a few days of practice to compare. Nothing is estimated before then.</div>`}</div>`;
    // milestones + records
    const ms = C.milestones(d.events, customCounts()), next = ms.items.find((i) => !i.achieved);
    h += `<h2>Milestones</h2><div class="h2sub">${num(ms.total)} lifetime repetitions. Private to you.</div><div class="card"><div class="jp-tl">${ms.items.map((i) => `<div class="jp-ms${i.achieved ? ' got' : ''}">
        <div class="n">${num(i.count)}${i.custom ? ` <button class="muted" style="font:500 12px Outfit,sans-serif" data-jact="ms-del" data-id="${i.count}">remove</button>` : ''}</div>
        <div class="s">${i.achieved ? 'Reached ' + fmt(i.date, { day: 'numeric', month: 'long', year: 'numeric' }) : i === next ? `${num(i.count - ms.total)} to go` : i.custom ? 'Your own milestone' : 'Ahead'}</div>${i === next ? track(i.frac, false) : ''}</div>`).join('')}</div>
      <div class="actions"><button class="btn sm line" data-jact="ms-add">+ Add your own milestone</button></div></div>`;
    const rc = C.records(days, d.sessions, d.events);
    h += `<h2>Personal records</h2><div class="card"><div class="jp-stats" style="margin-top:0">
      <div><div class="l">Most repetitions in a day</div><div class="v">${rc.bestDay ? `${num(rc.bestDay.reps)} <small>${dshort(rc.bestDay.date)}</small>` : '–'}</div></div>
      <div><div class="l">Most malas in one session</div><div class="v">${rc.bestSession ? `${num(rc.bestSession.malas)} <small>${rc.bestSession.date ? dshort(rc.bestSession.date) : ''}</small>` : '–'}</div></div>
      <div><div class="l">Longest session</div><div class="v">${rc.longestSession ? `${dur(rc.longestSession.seconds)} <small>${rc.longestSession.date ? dshort(rc.longestSession.date) : ''}</small>` : '–'}</div></div>
      <div><div class="l">Longest streak</div><div class="v">${rc.longestStreak ? `${rc.longestStreak.days} <small>${rc.longestStreak.days === 1 ? 'day' : 'days'}</small>` : '–'}</div></div>
    </div></div>`;
    return h;
  }
  function daySheet(date) {
    const d = D(), day = idx().get(date), td = today();
    const goals = C.goalsOn(d.goals, date).map((g) => C.goalProgress(g, idx(), date));
    const ss = d.sessions.filter((s) => eventsOf(s.id).some((e) => e.local_date === date && e.count > 0)).sort((a, b) => a.started_at.localeCompare(b.started_at));
    sheet(`<div class="eyebrow">${date === td ? 'Today' : fmt(date, { weekday: 'long' })}</div><h3>${fmt(date, { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
      ${day ? `<div class="jp-sum"><div><div class="v">${num(day.count)}</div><div class="l">repetitions</div></div><div><div class="v">${num(C.malasOfDay(day))}</div><div class="l">malas</div></div><div><div class="v">${dur(day.seconds)}</div><div class="l">practice time</div></div></div>` : `<p class="muted">No Jaap recorded on this day.</p>`}
      ${goals.length ? `<div class="lbl">Goals in effect</div>${goals.map((p) => `<div class="jp-note" style="margin:8px 0 6px">${goalLineOn(p)}</div>${track(p.frac, p.met)}`).join('')}` : ''}
      ${ss.length ? `<div class="lbl">Sessions</div><div class="card" style="padding:4px 16px">${ss.map((s) => sessionRow(s, date)).join('')}</div>` : ''}
      <button class="btn line block" style="margin-top:14px" data-jact="close">Close</button>`);
  }
  const goalLineOn = (p) => `<b>${esc(p.goal.mantra_id ? mname(p.goal.mantra_id) : 'All mantras')}</b> · ${C.GOAL_TYPES[p.type].label}: ${num(p.done)} of ${num(p.target)}${p.met ? ' · complete' : ''}`;

  // ---- goals
  function secGoals() {
    const d = D(), td = today(), days = idx(), ms = liveMantras();
    if (!ms.length) return `<div class="card jp-empty"><div class="big">Goals follow your mantras.</div><p>Choose a mantra first, then set a daily, weekly or monthly Sankalpa for it.</p><button class="btn primary" data-jact="add-mantra">Choose a mantra</button></div>`;
    let h = `<div class="h2sub" style="margin-top:8px">Set what feels right. Changing a goal never rewrites the past: earlier days keep the goal they had.</div>`;
    const group = (title, sub, mid) => {
      h += `<h2>${esc(title)}</h2>${sub ? `<div class="h2sub">${sub}</div>` : ''}<div class="card" style="padding:4px 18px">`;
      Object.keys(C.GOAL_TYPES).forEach((type) => {
        const g = C.goalOn(d.goals, type, mid, td), p = g ? C.goalProgress(g, days, td) : null;
        h += `<button class="jp-row" data-jact="goal" data-id="${type}|${mid || ''}"><div class="t"><div class="n">${C.GOAL_TYPES[type].label}</div>
          <div class="m">${p ? `${num(p.done)} of ${num(p.target)}${p.unit === 'malas' ? ` malas · ${num(p.targetReps)} repetitions` : ' repetitions'}${p.met ? ' · complete' : ''}` : 'Not set'}</div>${p ? track(p.frac, p.met) : ''}</div>
          <div class="r">${g ? `<b>${num(g.target_count)}</b>` : ''}</div><span class="chev">›</span></button>`;
      });
      h += `</div>`;
    };
    ms.forEach((m) => group(m.name, m.subtitle ? esc(m.subtitle) : '', m.id));
    group('Overall practice', 'Counts every mantra together.', null);
    const past = d.goals.filter((g) => g.effective_until && g.effective_until < td).sort((a, b) => b.effective_until.localeCompare(a.effective_until));
    if (past.length) h += `<h2>Earlier goals</h2><div class="card" style="padding:4px 18px">${past.slice(0, 20).map((g) => { const gd = C.goalDays([g], days, g.effective_from, g.effective_until, g.mantra_id || null);
      return `<div class="jp-row"><div class="t"><div class="n">${esc(g.mantra_id ? mname(g.mantra_id) : 'Overall')} · ${C.GOAL_TYPES[g.goal_type].label}</div><div class="m">${fmt(g.effective_from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(g.effective_until, { day: 'numeric', month: 'short', year: 'numeric' })}${C.GOAL_TYPES[g.goal_type].period === 'day' && gd.total ? ` · met on ${gd.met} of ${gd.total} days` : ''}</div></div><div class="r"><b>${num(g.target_count)}</b></div></div>`; }).join('')}</div>`;
    return h;
  }
  function goalSheet(type, mid) {
    const g = C.goalOn(D().goals, type, mid, today()), malas = C.GOAL_TYPES[type].unit === 'malas';
    J.form = { kind: 'goal', type, mid };
    sheet(`<div class="eyebrow">${esc(mid ? mname(mid) : 'Overall practice')}</div><h3>${C.GOAL_TYPES[type].label}</h3>
      <div class="jp-field"><label>${malas ? 'Malas' : 'Repetitions'} · ${GOAL_HINT[type]}</label><input id="jp-goal-n" type="number" inputmode="numeric" min="0" max="10000000" value="${g ? g.target_count : ''}" placeholder="${malas ? 'e.g. 5' : 'e.g. 1080'}"></div>
      <div class="jp-note" id="jp-goal-eq" style="margin-top:8px;min-height:20px">${malas && g ? `${num(g.target_count)} × 108 = ${num(g.target_count * 108)} repetitions` : ''}</div>
      ${malas ? `<div class="chips" style="margin-top:8px">${[1, 2, 3, 5, 11, 16].map((n) => `<button class="chip" data-jact="goal-n" data-id="${n}">${n}</button>`).join('')}</div>` : ''}
      <div class="jp-note" style="margin-top:14px">${g ? `In effect since ${fmt(g.effective_from, { day: 'numeric', month: 'long', year: 'numeric' })}. A new number applies from today; days before today keep ${num(g.target_count)}.` : 'Applies from today onward.'}</div>
      <div class="actions"><button class="btn primary" style="flex:1" data-jact="goal-save">Save goal</button>${g ? `<button class="btn danger" data-jact="goal-clear">Remove</button>` : ''}</div>`);
    setTimeout(() => document.getElementById('jp-goal-n')?.focus(), 150);
  }
  function setGoal(type, mid, target) {
    const d = D(), plan = C.planGoalChange(d.goals, type, mid, target, today());
    plan.close.forEach((c) => { const g = d.goals.find((x) => x.id === c.id); g.effective_until = c.effective_until; syncGoal(g); });
    plan.remove.forEach((id) => { d.goals = d.goals.filter((x) => x.id !== id); del('jaap_goals', id); });
    if (plan.update) { const g = d.goals.find((x) => x.id === plan.update.id); g.target_count = plan.update.target_count; syncGoal(g); }
    if (plan.insert) { const g = Object.assign({ id: uid(), created_at: new Date().toISOString() }, plan.insert); d.goals.push(g); syncGoal(g); }
    touch(true);
  }

  // ---- reminders
  const pausedUntil = () => { const s = D().settings; return s && s.paused_until && Date.parse(s.paused_until) > Date.now() ? s.paused_until : null; };
  const whenText = (isoStr) => Date.parse(isoStr) - Date.now() > 300 * 864e5 ? 'until you resume them' : 'until ' + new Date(isoStr).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function setPause(untilIso) {
    if (!S.user) return;
    const d = D(); d.settings = { user_id: S.user.id, paused_until: untilIso, updated_at: new Date().toISOString() };
    up('jaap_settings', d.settings, 'jset', 'user_id'); touch(true);
  }
  const daysText = (r) => { const dd = (r.days_of_week || []).slice().sort(); return dd.length === 7 ? 'Every day' : dd.join() === '1,2,3,4,5' ? 'Weekdays' : dd.join() === '0,6' ? 'Weekends' : dd.map((x) => DOWL[x].slice(0, 3)).join(', '); };
  function permissionCard() {
    if (!pushSupported()) {
      if (isIOS && !standalone()) return `<div class="banner"><b>Install to receive reminders on iPhone</b>iPhone delivers web notifications only to apps on the Home Screen (iOS 16.4 or later).
        <ol class="jp-steps"><li>Open this page in <b style="display:inline">Safari</b></li><li>Tap <b style="display:inline">Share</b>, then <b style="display:inline">Add to Home Screen</b></li><li>Open Sankalp from the Home Screen and sign in</li><li>Return here and tap <b style="display:inline">Enable notifications</b></li></ol>
        <div class="actions"><button class="btn sm primary" data-act="install">Show me how</button></div></div>`;
      return `<div class="banner"><b>This browser cannot receive notifications</b>${isIOS ? 'This iPhone needs iOS 16.4 or later for notifications from Home Screen apps.' : 'Reminders you create are saved to your account and will arrive on any phone where Sankalp is installed with notifications enabled.'}</div>`;
    }
    if (Notification.permission === 'denied') return `<div class="banner miss"><b>Notifications are blocked on this phone</b>Reminders cannot be shown here until you allow them. ${isIOS ? 'Open Settings → Notifications → Sankalp and turn on Allow Notifications.' : 'Long-press the Sankalp icon → App info → Notifications → Allow. In a browser tab: the lock icon in the address bar → Notifications → Allow.'} Then come back and enable them here.
      <div class="actions"><button class="btn sm line" data-act="push">Try again</button></div></div>`;
    if (!pushOn()) return `<div class="banner"><b>Turn on notifications</b>Reminders arrive as notifications on this phone. You will be asked for permission once.
      <div class="actions"><button class="btn sm primary" data-act="push">Enable notifications</button></div></div>`;
    return `<div class="card"><div class="toggle" style="padding:0"><div><b>Notifications are on for this phone</b><div class="muted" style="font-size:13px;margin-top:2px">Reminders also reach your other phones where they are enabled.</div></div></div>
      <div class="actions"><button class="btn sm line" data-jact="rem-test">Send a test</button></div></div>`;
  }
  function secReminders() {
    const d = D(), p = pausedUntil();
    let h = `<div style="height:8px"></div>${permissionCard()}`;
    h += p ? `<div class="banner"><b>Reminders are paused</b>Nothing will be sent ${whenText(p)}. Your reminders and their times are kept as they are.
        <div class="actions"><button class="btn sm primary" data-jact="pause" data-id="0">Resume now</button></div></div>`
      : (d.reminders.length ? `<div class="card"><b>Pause all reminders</b><div class="muted" style="font-size:13px;margin:3px 0 0;line-height:1.45">For travel, illness or a quiet spell. Naam Jaap reminders stop, then return by themselves.</div>
        <div class="chips" style="margin-top:12px">${[['1', 'Until tomorrow'], ['3', '3 days'], ['7', '1 week'], ['x', 'Until I resume']].map(([k, l]) => `<button class="chip" data-jact="pause" data-id="${k}">${l}</button>`).join('')}</div></div>` : '');
    h += `<h2>Your reminders</h2>`;
    if (!d.reminders.length) h += `<div class="card"><div class="muted" style="font-size:14.5px;line-height:1.5">No reminders yet. Every reminder is optional and can be changed or switched off at any time.</div></div>`;
    else h += `<div class="card" style="padding:4px 18px">${d.reminders.slice().sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time))).map((r) => `<div class="jp-row">
        <div class="t" data-jact="rem-edit" data-id="${r.id}" role="button"><div class="n">${esc(r.name)}</div><div class="m">${hm(r.scheduled_time)} · ${daysText(r)} · ${TYPES[r.reminder_type][0]}${r.mantra_id ? ' · ' + esc(mname(r.mantra_id)) : ''}</div></div>
        <button class="sw ${r.enabled ? 'on' : ''}" data-jact="rem-toggle" data-id="${r.id}" aria-label="${r.enabled ? 'Turn off' : 'Turn on'} ${esc(r.name)}"></button></div>`).join('')}</div>`;
    h += `<button class="btn primary block" data-jact="rem-new">+ New reminder</button>`;
    if (d.logs.length) h += `<h2>Recent deliveries</h2><div class="card" style="padding:4px 18px">${d.logs.slice(0, 8).map((l) => `<div class="jp-row"><div class="t"><div class="n" style="font-size:14.5px">${esc(l.title || (D().reminders.find((r) => r.id === l.reminder_id) || {}).name || 'Reminder')}</div>
        <div class="m">${esc(l.body || l.error || '')}</div><div class="m">${new Date(l.scheduled_for).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${l.attempt_count > 1 ? ` · ${l.attempt_count} attempts` : ''}</div></div>
        <span class="jp-status ${l.delivery_status === 'sent' ? 'sent' : l.delivery_status === 'failed' || l.delivery_status === 'no_subscription' ? 'failed' : ''}">${{ sent: 'Sent', skipped: 'Not needed', failed: 'Failed', retrying: 'Retrying', pending: 'Sending', no_subscription: 'No device' }[l.delivery_status] || l.delivery_status}</span></div>`).join('')}</div>`;
    h += `<div class="jp-note" style="margin:18px 4px 0">Reminders are sent from the server, normally within a minute of the time you set, and need this phone to be online. A failed send is retried up to three times; a reminder more than an hour late is skipped. Your phone's Focus or Do Not Disturb settings can hold or silence them. On iPhone they arrive only when Sankalp is installed on the Home Screen, and the Snooze button on the notification itself is available on Android; on iPhone, open the notification to snooze.</div>`;
    return h;
  }
  function remSheet(id) {
    const r = id ? D().reminders.find((x) => x.id === id) : null;
    J.form = r ? Object.assign({ kind: 'rem', isNew: false }, JSON.parse(JSON.stringify(r)), { time: String(r.scheduled_time).slice(0, 5) })
      : { kind: 'rem', isNew: true, id: uid(), name: 'Morning Jaap', reminder_type: 'scheduled', time: '06:00', mantra_id: null, days_of_week: [0, 1, 2, 3, 4, 5, 6], enabled: true, target_count: null, sound: 'default', snooze_minutes: 10 };
    drawRem();
  }
  function drawRem() {
    const f = J.form, weekly = f.reminder_type === 'weekly_reflection', canAct = ['scheduled', 'incomplete_goal', 'resume'].includes(f.reminder_type);
    sheet(`<h3>${f.isNew ? 'New reminder' : 'Edit reminder'}</h3>
      ${f.isNew ? `<div class="lbl">Start from</div><div class="chips">${TEMPLATES.map((t, i) => `<button class="chip ${f.name === t[0] && f.reminder_type === t[1] ? 'on' : ''}" data-jact="rem-tpl" data-id="${i}">${t[0]}<small>${hm(t[2])}</small></button>`).join('')}</div>` : ''}
      <div class="jp-field"><label>Kind</label><select data-jf="reminder_type">${Object.keys(TYPES).map((k) => opt(k, TYPES[k][0], f.reminder_type)).join('')}</select><div class="jp-note" style="margin-top:6px">${TYPES[f.reminder_type][1]}</div></div>
      <div class="jp-field"><label>Name</label><input data-jf="name" maxlength="60" value="${esc(f.name)}"></div>
      <div class="two" style="margin-top:14px"><div><label>Time</label><input type="time" data-jf="time" value="${esc(f.time)}"></div>
        ${canAct ? `<div><label>Mantra</label><select data-jf="mantra_id">${mantraOptions(f.mantra_id, 'Any mantra')}</select></div>` : '<div></div>'}</div>
      <div class="jp-field"><label>${weekly ? 'Day of the week' : 'Days'}</label><div class="jp-days">${DOW.map((l, i) => `<button class="${f.days_of_week.includes(i) ? 'on' : ''}" data-jact="rem-day" data-id="${i}" aria-label="${DOWL[i]}">${l}</button>`).join('')}</div></div>
      ${f.reminder_type === 'scheduled' ? `<div class="jp-field"><label>Target repetitions (optional)</label><input type="number" inputmode="numeric" min="0" data-jf="target_count" value="${f.target_count || ''}" placeholder="e.g. 108"></div>` : ''}
      <div class="two" style="margin-top:14px"><div><label>Sound</label><select data-jf="sound">${opt('default', 'Phone default', f.sound)}${opt('silent', 'Silent', f.sound)}</select></div>
        ${canAct ? `<div><label>Snooze for</label><select data-jf="snooze_minutes">${[5, 10, 15, 30, 60].map((n) => opt(n, n + ' minutes', f.snooze_minutes)).join('')}</select></div>` : '<div></div>'}</div>
      <div class="jp-note" style="margin-top:8px">The tone itself is chosen in your phone's notification settings. Silent delivery is honoured on Android; an iPhone follows its own notification settings.</div>
      <div class="toggle" style="margin-top:6px"><b>Enabled</b><button class="sw ${f.enabled ? 'on' : ''}" data-jact="rem-en" aria-label="Enabled"></button></div>
      <div class="jp-note" id="jp-preview"></div>
      <div class="actions"><button class="btn primary" style="flex:1" data-jact="rem-save">Save</button>${f.isNew ? '' : `<button class="btn line" data-jact="rem-preview">Preview</button><button class="btn danger" data-jact="rem-del">Delete</button>`}</div>`);
  }
  function saveRem() {
    const f = J.form, d = D();
    const name = (f.name || '').trim(); if (!name) return toast('Give the reminder a name');
    if (!/^\d\d:\d\d$/.test(f.time || '')) return toast('Choose a time');
    if (!f.days_of_week.length) return toast('Choose at least one day');
    const canAct = ['scheduled', 'incomplete_goal', 'resume'].includes(f.reminder_type);
    const row = { id: f.id, mantra_id: canAct ? (f.mantra_id || null) : null, reminder_type: f.reminder_type, name, scheduled_time: f.time + ':00', timezone: tz(),
      days_of_week: f.days_of_week.slice().sort(), enabled: !!f.enabled, target_count: f.reminder_type === 'scheduled' && +f.target_count > 0 ? Math.floor(+f.target_count) : null,
      sound: f.sound === 'silent' ? 'silent' : 'default', snooze_minutes: +f.snooze_minutes || 10, snoozed_until: null, created_at: f.created_at || new Date().toISOString() };
    const i = d.reminders.findIndex((x) => x.id === row.id);
    if (i >= 0) d.reminders[i] = row; else d.reminders.push(row);
    syncReminder(row); touch(true); closeSheet(); render();
    toast(pushOn() ? `Saved · ${hm(row.scheduled_time)}` : 'Saved. Enable notifications on this phone to receive it', 3200);
  }
  async function fn(body) {
    const { data } = await client().auth.getSession();
    const headers = { 'Content-Type': 'application/json', apikey: CFG.key };
    if (data?.session) headers.Authorization = 'Bearer ' + data.session.access_token;
    const r = await fetch(CFG.url + '/functions/v1/jaap', { method: 'POST', headers, body: JSON.stringify(body) });
    return r.json();
  }
  function remindSheet(id) {
    const r = D().reminders.find((x) => x.id === id); if (!r) return;
    const m = r.mantra_id && mantra(r.mantra_id) ? r.mantra_id : (LS.get('jaapLast', null) && mantra(LS.get('jaapLast', null)) ? LS.get('jaapLast', null) : (liveMantras()[0] || {}).id);
    sheet(`<div class="eyebrow">${hm(r.scheduled_time)}</div><h3>${esc(r.name)}</h3><p class="muted" style="line-height:1.5">A peaceful moment for yourself.</p>
      <div class="actions" style="flex-direction:column">${m ? `<button class="btn primary block" data-jact="begin" data-id="${m}">Begin ${esc(mname(m))}</button>` : ''}
      <button class="btn line block" data-jact="rem-snooze" data-id="${r.id}">Snooze ${r.snooze_minutes} minutes</button><button class="btn block" style="background:none;color:var(--muted)" data-jact="close">Not now</button></div>`);
  }

  // ---- history
  const sessionDate = (s) => { const e = eventsOf(s.id).filter((x) => x.count > 0).map((x) => x.local_date).sort(); return e[0] || localDate(s.started_at); };
  function contribution(s, date, reps) {
    const gs = C.goalsOn(D().goals, date).filter((g) => C.GOAL_TYPES[g.goal_type].period === 'day' && (!g.mantra_id || g.mantra_id === s.mantra_id)).sort((a, b) => (a.mantra_id ? 0 : 1) - (b.mantra_id ? 0 : 1));
    if (!gs.length) return 'No daily goal that day';
    const g = gs[0], target = g.goal_type === 'daily_malas' ? g.target_count * 108 : g.target_count;
    return `${Math.min(999, Math.round((reps / target) * 100))}% of that day's ${g.mantra_id ? '' : 'overall '}goal`;
  }
  function sessionRow(s, onlyDate) {
    const ev = eventsOf(s.id).filter((e) => !onlyDate || e.local_date === onlyDate);
    const reps = ev.reduce((n, e) => n + e.count, 0), sec = ev.reduce((n, e) => n + e.seconds, 0), date = onlyDate || sessionDate(s);
    const span = s.source === 'manual' ? 'Added by hand' : `${tm(s.started_at)} – ${s.ended_at ? tm(s.ended_at) : 'in progress'}`;
    const multi = !onlyDate && new Set(eventsOf(s.id).filter((e) => e.count > 0).map((e) => e.local_date)).size > 1;
    return `<button class="jp-row" data-jact="session" data-id="${s.id}"><div class="t"><div class="n">${esc(mname(s.mantra_id))}</div>
      <div class="m">${span}${multi ? ' · continued past midnight' : ''}${s.edited_at ? ' · corrected' : ''}</div><div class="m">${contribution(s, date, reps)}</div></div>
      <div class="r"><b>${num(reps)}</b>${plural(Math.floor(reps / 108), 'mala')}${sec ? ' · ' + dur(sec) : ''}</div><span class="chev">›</span></button>`;
  }
  function secHistory() {
    const d = D(), f = J.ui.hist, td = today();
    let list = d.sessions.filter((s) => s.status === 'active' || eventsOf(s.id).some((e) => e.count > 0)).map((s) => ({ s, date: sessionDate(s) }));
    if (f.mantra) list = list.filter((x) => x.s.mantra_id === f.mantra);
    if (f.from) list = list.filter((x) => x.date >= f.from);
    if (f.to) list = list.filter((x) => x.date <= f.to);
    list.sort((a, b) => b.date.localeCompare(a.date) || b.s.started_at.localeCompare(a.s.started_at));
    let h = `<div class="card" style="margin-top:8px"><div class="jp-field" style="margin-top:0"><label>Mantra</label><select data-jf="hmantra">${mantraOptions(f.mantra, 'All mantras')}</select></div>
      <div class="jp-custom"><div><label>From</label><input type="date" data-jf="hfrom" max="${td}" value="${esc(f.from)}"></div><div><label>To</label><input type="date" data-jf="hto" max="${td}" value="${esc(f.to)}"></div></div>
      ${f.mantra || f.from || f.to ? `<div class="actions"><button class="btn sm line" data-jact="hist-clear">Clear filters</button></div>` : ''}</div>`;
    if (!list.length) h += `<div class="card"><div class="muted" style="font-size:14.5px">${d.sessions.length ? 'No sessions match these filters.' : 'Your sessions will be listed here.'}</div></div>`;
    let cur = '', open = false;
    list.slice(0, J.ui.histN).forEach((x) => {
      if (x.date !== cur) { if (open) h += `</div>`; cur = x.date; open = true; h += `<div class="jp-date">${x.date === td ? 'Today · ' : ''}${fmt(x.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</div><div class="card" style="padding:4px 18px">`; }
      h += sessionRow(x.s);
    });
    if (open) h += `</div>`;
    if (list.length > J.ui.histN) h += `<button class="btn line block" data-jact="hist-more">Show earlier sessions</button>`;
    if (liveMantras().length) h += `<button class="btn line block" style="margin-top:10px" data-jact="session-new">+ Add a past session</button>`;
    return h;
  }
  function sessionSheet(id) {
    const d = D(), s = id ? d.sessions.find((x) => x.id === id) : null;
    if (id && !s) return;
    const t = s ? C.sessionTotals(s, d.events) : null, date = s ? sessionDate(s) : today();
    J.form = { kind: 'session', id: s ? s.id : null };
    sheet(s ? `<div class="eyebrow">${fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div><h3>${esc(mname(s.mantra_id))}</h3>
      <div class="jp-sum"><div><div class="v">${num(t.count)}</div><div class="l">repetitions</div></div><div><div class="v">${num(t.malas)}</div><div class="l">malas</div></div><div><div class="v">${t.seconds ? dur(t.seconds) : '–'}</div><div class="l">duration</div></div></div>
      <div class="jp-note">${s.source === 'manual' ? 'Added by hand' : `Started ${tm(s.started_at)} · ${s.ended_at ? 'ended ' + tm(s.ended_at) : 'still in progress'}`} · ${contribution(s, date, t.count)}</div>
      <div class="lbl">Correct this session</div>
      <div class="two"><div><label>Repetitions</label><input id="jp-s-count" type="number" inputmode="numeric" min="0" max="10000000" value="${t.count}"></div><div><label>Mantra</label><select id="jp-s-mantra">${mantraOptions(s.mantra_id)}</select></div></div>
      <div class="jp-note" style="margin-top:8px">Totals, streaks, goals and milestones are recalculated when you save.</div>
      <div class="actions">${s.status === 'active' ? `<button class="btn primary" data-jact="begin" data-id="${s.mantra_id}">Resume</button>` : ''}<button class="btn ${s.status === 'active' ? 'line' : 'primary'}" style="flex:1" data-jact="session-save">Save changes</button><button class="btn danger" data-jact="session-del">Delete</button></div>`
      : `<h3>Add a past session</h3><p class="muted" style="margin:4px 0 0;line-height:1.5">For Jaap you counted on a mala, away from the phone.</p>
      <div class="jp-field"><label>Mantra</label><select id="jp-s-mantra">${mantraOptions(LS.get('jaapLast', ''))}</select></div>
      <div class="two" style="margin-top:14px"><div><label>Date</label><input id="jp-s-date" type="date" max="${today()}" value="${today()}"></div><div><label>Repetitions</label><input id="jp-s-count" type="number" inputmode="numeric" min="1" max="10000000" placeholder="e.g. 108"></div></div>
      <div class="jp-field"><label>Minutes spent (optional)</label><input id="jp-s-min" type="number" inputmode="numeric" min="0" max="1440"></div>
      <div class="actions"><button class="btn primary" style="flex:1" data-jact="session-save">Add session</button></div>`);
  }
  function saveSession() {
    const d = D(), id = J.form.id, count = Math.floor(+document.getElementById('jp-s-count').value), mid = document.getElementById('jp-s-mantra').value;
    if (!(count >= 0) || count > 10000000) return toast('Enter the number of repetitions');
    if (!mantra(mid)) return toast('Choose a mantra');
    if (!id) {
      if (!count) return toast('Enter the number of repetitions');
      const date = document.getElementById('jp-s-date').value, min = Math.max(0, Math.min(1440, Math.floor(+document.getElementById('jp-s-min').value || 0)));
      if (!/^\d{4}-\d\d-\d\d$/.test(date) || date > today()) return toast('Choose a date up to today');
      const at = new Date(date + 'T12:00:00').toISOString();
      const s = { id: uid(), mantra_id: mid, started_at: at, ended_at: at, status: 'finished', tz: tz(), source: 'manual', edited_at: null };
      const e = { session_id: s.id, local_date: date, mantra_id: mid, count, seconds: min * 60, first_at: at, last_at: at };
      d.sessions.push(s); d.events.push(e); syncSession(s); syncEvent(e);
    } else {
      const s = d.sessions.find((x) => x.id === id); if (!s) return;
      let changed = false;
      if (s.mantra_id !== mid) { s.mantra_id = mid; eventsOf(id).forEach((e) => { e.mantra_id = mid; }); changed = true; }
      const cur = eventsOf(id);
      if (C.sessionTotals(s, d.events).count !== count) {
        if (!cur.length) { const e = { session_id: id, local_date: localDate(s.started_at), mantra_id: mid, count, seconds: 0, first_at: s.started_at, last_at: s.started_at }; d.events.push(e); }
        else C.redistribute(cur, count).forEach((nb) => { const e = d.events.find((x) => x.session_id === id && x.local_date === nb.local_date); e.count = nb.count; });
        changed = true;
      }
      if (!changed) { closeSheet(); return; }
      s.edited_at = new Date().toISOString();
      syncSession(s); eventsOf(id).forEach(syncEvent);        // the session first: the server moves its events to the new mantra
    }
    touch(true); reconcileMilestones(false); closeSheet(); render(); toast(id ? 'Corrected. Your statistics are recalculated' : 'Session added');
  }
  function deleteSession(id) {
    const d = D();
    d.sessions = d.sessions.filter((s) => s.id !== id); d.events = d.events.filter((e) => e.session_id !== id);
    del('jaap_sessions', id); touch(true); reconcileMilestones(false);
  }

  // ---- mantras
  function mantraPicker() {
    J.form = { kind: 'mantras', sel: new Set(), q: '' };
    sheet(`<div class="eyebrow">Naam Jaap</div><h3>Choose your mantra.</h3><p class="muted" style="margin:4px 0 12px;line-height:1.5">Pick one or more, or write your own.</p>
      <input id="jp-q" placeholder="Search mantras…" autocomplete="off"><div id="jp-presets" style="margin-top:12px"></div>
      <div class="lbl">Or your own</div><input id="jp-own" maxlength="80" placeholder="Type a mantra or naam">
      <div class="actions"><button class="btn primary block" data-jact="mantra-add" id="jp-madd">Add</button></div>`);
    drawPresets();
  }
  function drawPresets() {
    const f = J.form, have = new Set(liveMantras().map((m) => m.preset_key)), q = f.q.trim().toLowerCase();
    const list = PRESETS.filter((p) => !have.has(p[0]) && (!q || (p[1] + ' ' + p[2]).toLowerCase().includes(q)));
    document.getElementById('jp-presets').innerHTML = list.map((p) => `<button class="jp-preset ${f.sel.has(p[0]) ? 'on' : ''}" data-jact="preset" data-id="${p[0]}"><div><div class="n">${p[1]}</div><div class="s">${p[2]}</div><div class="d">${p[3]}</div></div><span class="ck">✓</span></button>`).join('')
      || `<div class="muted" style="font-size:14px;padding:6px 2px">${q ? 'No match. You can add it as your own below.' : 'All suggested mantras are already added.'}</div>`;
  }
  function addMantras() {
    const d = D(), f = J.form, own = document.getElementById('jp-own').value.trim();
    const rows = PRESETS.filter((p) => f.sel.has(p[0])).map((p) => ({ name: p[1], subtitle: p[2], preset_key: p[0] }));
    if (own) rows.push({ name: own.slice(0, 80), subtitle: null, preset_key: null });
    if (!rows.length) return toast('Choose a mantra, or type your own');
    let sort = d.mantras.reduce((n, m) => Math.max(n, m.sort || 0), 0);
    rows.forEach((r) => {
      const old = d.mantras.find((m) => m.archived && ((r.preset_key && m.preset_key === r.preset_key) || m.name.toLowerCase() === r.name.toLowerCase()));
      if (old) { old.archived = false; syncMantra(old); return; }                      // bringing one back keeps its history
      const m = Object.assign({ id: uid(), archived: false, sort: ++sort, created_at: new Date().toISOString() }, r);
      d.mantras.push(m); syncMantra(m);
    });
    touch(true); closeSheet(); J.ui.sec = 'home'; render();
  }
  function mantraSheet(id) {
    const m = mantra(id); if (!m) return;
    const used = D().events.some((e) => e.mantra_id === id && e.count > 0);
    J.form = { kind: 'mantra', id };
    sheet(`<div class="eyebrow">Mantra</div><h3>${esc(m.name)}</h3>
      <div class="jp-field"><label>Name</label><input id="jp-m-name" maxlength="80" value="${esc(m.name)}"></div>
      <div class="actions"><button class="btn primary" style="flex:1" data-jact="mantra-save">Save</button><button class="btn line" data-jact="mantra-goals">Goals</button></div>
      <div class="jp-note" style="margin-top:18px">${used ? 'Removing a mantra from your list keeps every repetition you have counted with it. You can add it back at any time.' : 'This mantra has no counted repetitions yet.'}</div>
      <div class="actions"><button class="btn danger" data-jact="mantra-archive">Remove from my list</button></div>`);
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-jact]'); if (!el) return;
    const act = el.dataset.jact, id = el.dataset.id, d = D();
    switch (act) {
      case 'bg': if (e.target === el) closeSheet(); break;
      case 'close': closeSheet(); break;
      case 'sec': J.ui.sec = id; J.ui.sel = null; S.enter = true; render(); scrollTo(0, 0); if (id === 'reminders') pull(); break;
      case 'goto': S.tab = 'jaap'; J.ui.sec = id; S.enter = true; render(); scrollTo(0, 0); break;
      case 'begin': begin(id); break;
      case 'c-min': commitLive(); leaveCounter(); render(); break;
      case 'c-finish': finishCounter(); break;
      case 'c-undo': tap(-1); break;
      case 'finish-quiet': finishSession(id, true); reconcileMilestones(false); render(); toast('Session finished'); break;
      case 'add-mantra': mantraPicker(); break;
      case 'preset': J.form.sel.has(id) ? J.form.sel.delete(id) : J.form.sel.add(id); drawPresets(); break;
      case 'mantra-add': addMantras(); break;
      case 'mantra': mantraSheet(id); break;
      case 'mantra-save': { const m = mantra(J.form.id), v = document.getElementById('jp-m-name').value.trim(); if (!v) break; m.name = v.slice(0, 80); syncMantra(m); touch(true); closeSheet(); render(); break; }
      case 'mantra-goals': closeSheet(); J.ui.sec = 'goals'; render(); scrollTo(0, 0); break;
      case 'mantra-archive': { const m = mantra(J.form.id); if (!confirm(`Remove ${m.name} from your list? Everything you have counted stays in your history.`)) break;
        const used = d.events.some((x) => x.mantra_id === m.id) || d.sessions.some((x) => x.mantra_id === m.id);
        if (used) { m.archived = true; syncMantra(m); } else { d.mantras = d.mantras.filter((x) => x !== m); d.goals = d.goals.filter((g) => g.mantra_id !== m.id); del('jaap_mantras', m.id); }
        touch(true); closeSheet(); render(); break; }
      case 'range': J.ui.range = id; J.ui.sel = null; if (id === 'custom' && !J.ui.custom.from) J.ui.custom = { from: C.addDays(today(), -13), to: today() }; render(); break;
      case 'metric': J.ui.metric = id; render(); break;
      case 'bar': {
        J.ui.sel = J.ui.sel === id ? null : id;
        document.querySelectorAll('.jp-bar').forEach((b) => b.classList.toggle('sel', b.dataset.id === J.ui.sel));
        const se = C.series(idx(), curRange(), J.ui.metric), old = document.getElementById('jp-detail');
        if (old) old.outerHTML = detailHtml(se.buckets.find((b) => b.key === J.ui.sel), se.size);
        break; }
      case 'day': daySheet(id); break;
      case 'ms-add': J.form = { kind: 'ms' }; sheet(`<h3>Your own milestone</h3><div class="jp-field"><label>Lifetime repetitions</label><input id="jp-ms-n" type="number" inputmode="numeric" min="1" max="100000000" placeholder="e.g. 51000"></div>
        <div class="actions"><button class="btn primary block" data-jact="ms-save">Add milestone</button></div>`); setTimeout(() => document.getElementById('jp-ms-n')?.focus(), 150); break;
      case 'ms-save': { const n = Math.floor(+document.getElementById('jp-ms-n').value); if (!(n > 0) || n > 100000000) { toast('Enter a number of repetitions'); break; }
        if (C.STD_MILESTONES.includes(n) || d.milestones.some((m) => !m.mantra_id && m.milestone_count === n)) { toast('That milestone is already on your timeline'); break; }
        const r = { id: uid(), mantra_id: null, milestone_count: n, is_custom: true, achieved_at: null, created_at: new Date().toISOString() };
        d.milestones.push(r); up('jaap_milestones', Object.assign({ user_id: S.user.id }, pick(r, ['id', 'mantra_id', 'milestone_count', 'is_custom', 'achieved_at'])), 'jms:' + n, 'user_id,mantra_id,milestone_count');
        touch(true); reconcileMilestones(false); closeSheet(); render(); break; }
      case 'ms-del': { const r = d.milestones.find((m) => !m.mantra_id && m.is_custom && m.milestone_count === +id); if (!r || !confirm('Remove this milestone?')) break;
        d.milestones = d.milestones.filter((m) => m !== r); del('jaap_milestones', r.id); touch(true); render(); break; }
      case 'goal': { const [type, mid] = id.split('|'); goalSheet(type, mid || null); break; }
      case 'goal-n': { const i = document.getElementById('jp-goal-n'); i.value = id; i.dispatchEvent(new Event('input', { bubbles: true })); break; }
      case 'goal-save': { const n = Math.floor(+document.getElementById('jp-goal-n').value); if (!(n > 0) || n > 10000000) { toast('Enter a number above zero, or use Remove'); break; }
        setGoal(J.form.type, J.form.mid, n); closeSheet(); render(); toast('Goal saved. It applies from today'); break; }
      case 'goal-clear': if (confirm('Remove this goal from today? Earlier days keep it in their history.')) { setGoal(J.form.type, J.form.mid, 0); closeSheet(); render(); } break;
      case 'pause': {
        if (id === '0') { setPause(null); render(); toast('Reminders resumed'); break; }
        let until;
        if (id === 'x') until = '9999-12-31T00:00:00.000Z';
        else { const t = new Date(); t.setDate(t.getDate() + +id); if (id === '1') t.setHours(4, 0, 0, 0); until = t.toISOString(); }
        setPause(until); render(); toast('Reminders paused ' + whenText(until), 3200); break; }
      case 'rem-new': remSheet(null); break;
      case 'rem-edit': remSheet(id); break;
      case 'rem-tpl': { const t = TEMPLATES[+id]; Object.assign(J.form, { name: t[0], reminder_type: t[1], time: t[2], days_of_week: t[1] === 'weekly_reflection' ? [0] : [0, 1, 2, 3, 4, 5, 6] }); drawRem(); break; }
      case 'rem-day': { const f = J.form, n = +id;
        if (f.reminder_type === 'weekly_reflection') f.days_of_week = [n]; else f.days_of_week = f.days_of_week.includes(n) ? f.days_of_week.filter((x) => x !== n) : [...f.days_of_week, n];
        el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', f.days_of_week.includes(+b.dataset.id))); break; }
      case 'rem-en': J.form.enabled = !J.form.enabled; el.classList.toggle('on', J.form.enabled); break;
      case 'rem-save': saveRem(); break;
      case 'rem-del': if (confirm('Delete this reminder?')) { d.reminders = d.reminders.filter((r) => r.id !== J.form.id); del('jaap_reminders', J.form.id); touch(true); closeSheet(); render(); } break;
      case 'rem-toggle': { const r = d.reminders.find((x) => x.id === id); r.enabled = !r.enabled; syncReminder(r); touch(true); render(); break; }
      case 'rem-preview': { const box = document.getElementById('jp-preview'); if (!navigator.onLine) { box.textContent = 'Connect to the internet to preview.'; break; }
        box.textContent = 'Checking…';
        try { await flush(); const r = await fn({ action: 'preview', reminder_id: J.form.id }); const m = r.message || {};
          box.innerHTML = m.body ? `If it were due now, it would say: <b>${esc(m.title)}</b> · ${esc(m.body)} <span class="muted">(Preview shows the saved version.)</span>` : m.skip ? `If it were due now, nothing would be sent: ${esc(m.skip)}.` : 'Save the reminder first, then preview.'; }
        catch { box.textContent = 'Could not load the preview.'; } break; }
      case 'rem-test': { if (!navigator.onLine) { toast('Connect to the internet first'); break; }
        try { const r = await fn({ action: 'test' }); toast(r.sent ? 'Sent. It should appear in a moment' : r.devices ? 'The push service refused it. Turn notifications off and on in Settings' : 'No phone is registered. Enable notifications first', 3600); } catch { toast('Could not send the test'); } break; }
      case 'rem-snooze': { const r = d.reminders.find((x) => x.id === id); closeSheet();
        try { const out = await fn({ action: 'snooze', reminder_id: id }); toast(out.ok ? `Snoozed for ${out.minutes} minutes` : 'Could not snooze'); } catch { toast('Could not snooze while offline'); } void r; break; }
      case 'hist-more': J.ui.histN += 30; render(); break;
      case 'hist-clear': J.ui.hist = { mantra: '', from: '', to: '' }; render(); break;
      case 'session': sessionSheet(id); break;
      case 'session-new': sessionSheet(null); break;
      case 'session-save': saveSession(); break;
      case 'session-del': if (confirm('Delete this session? Its repetitions will be removed from your totals, streaks and goals.')) { deleteSession(J.form.id); closeSheet(); render(); toast('Deleted. Your statistics are recalculated'); } break;
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'jp-q' && J.form) { J.form.q = t.value; drawPresets(); }
    if (t.id === 'jp-goal-n' && J.form) { const n = Math.floor(+t.value), eq = document.getElementById('jp-goal-eq'); if (eq) eq.textContent = C.GOAL_TYPES[J.form.type].unit === 'malas' && n > 0 ? `${num(n)} × 108 = ${num(n * 108)} repetitions` : ''; }
    if (t.dataset && t.dataset.jf && J.form && J.form.kind === 'rem') { const k = t.dataset.jf; if (k === 'name' || k === 'time' || k === 'target_count') J.form[k] = t.value; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset && t.dataset.jf; if (!k) return;
    if (J.form && J.form.kind === 'rem') {
      J.form[k] = k === 'snooze_minutes' ? +t.value : t.value;
      if (k === 'reminder_type') {
        const names = TEMPLATES.map((x) => x[0]), tpl = TEMPLATES.find((x) => x[1] === t.value);
        if (names.includes(J.form.name) || !J.form.name) J.form.name = t.value === 'scheduled' ? 'Morning Jaap' : tpl[0];
        if (t.value === 'weekly_reflection') J.form.days_of_week = [J.form.days_of_week.length === 1 ? J.form.days_of_week[0] : 0];
        drawRem();
      }
      return;
    }
    if (k === 'cfrom' || k === 'cto') { J.ui.custom[k === 'cfrom' ? 'from' : 'to'] = t.value; J.ui.sel = null; render(); }
    if (k === 'hmantra') { J.ui.hist.mantra = t.value; J.ui.histN = 30; render(); }
    if (k === 'hfrom') { J.ui.hist.from = t.value; render(); }
    if (k === 'hto') { J.ui.hist.to = t.value; render(); }
  });
  document.addEventListener('toggle', (e) => { const t = e.target; if (t.classList && t.classList.contains('jp-m')) { if (t.open) { J.ui.openMantra = t.dataset.id; document.querySelectorAll('details.jp-m').forEach((x) => { if (x !== t) x.open = false; }); } else if (J.ui.openMantra === t.dataset.id) J.ui.openMantra = null; } }, true);
  const leaving = () => { if (J.counter) commitLive(); else if (J.saveTimer) touch(true); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leaving();
    else if (J.counter) { J.counter.lastTap = 0; if (navigator.wakeLock && !J.wake) navigator.wakeLock.request('screen').then((w) => { J.wake = w; }).catch(() => {}); paintCounter(false); }
  });
  window.addEventListener('pagehide', leaving);
  window.addEventListener('online', paintSync); window.addEventListener('offline', paintSync);
  setInterval(paintSync, 2000);

  // after the main render(): grow the bars, and keep the newest days in view
  function afterRender() {
    if (S.tab !== 'jaap') return;
    const bars = document.querySelectorAll('.jp-bar i[data-h]');
    if (bars.length) requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach((b) => { b.style.height = b.dataset.h + '%'; })));
    ['jp-scroll', 'jp-heat'].forEach((k) => { const el = document.getElementById(k); if (el && !el.dataset.done) { if (el.scrollWidth > el.clientWidth + 1) el.scrollLeft = el.scrollWidth; el.dataset.done = '1'; } });
  }
  // deep links from a notification: ?jaap=remind&r=<id> | journey | reminders
  function openLink(url) {
    let q; try { q = new URL(url, location.href).searchParams; } catch { return; }
    const k = q.get('jaap'); if (!k || !S.user) return;
    history.replaceState(null, '', location.pathname);
    if (J.counter) return;
    S.tab = 'jaap'; J.ui.sec = k === 'journey' ? 'journey' : k === 'reminders' ? 'reminders' : 'home'; S.enter = true; render();
    if (k === 'remind' && q.get('r')) remindSheet(q.get('r'));
  }

  window.Jaap = { view, homeCard, pull, reset, afterRender, openLink, _state: J, _data: D };
})();
