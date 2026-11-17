// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../jaap-core.js');

const OM = 'om', RAM = 'ram';
const ev = (session_id, local_date, mantra_id, count, seconds = 0, first_at = null) =>
  ({ session_id, local_date, mantra_id, count, seconds, first_at: first_at || local_date + 'T06:00:00Z', last_at: local_date + 'T06:30:00Z' });

test('dates: add, diff, week and month boundaries, DST-proof', () => {
  assert.equal(C.addDays('2026-03-08', 1), '2026-03-09');          // US spring-forward day
  assert.equal(C.addDays('2026-11-01', 1), '2026-11-02');          // US fall-back day
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.diffDays('2026-02-27', '2026-03-01'), 2);
  assert.equal(C.weekStart('2026-11-17'), '2026-11-16');           // Tuesday → Monday
  assert.equal(C.weekStart('2026-11-22'), '2026-11-16');           // Sunday belongs to the week that began Monday
  assert.equal(C.monthEnd('2028-02-10'), '2028-02-29');
});

test('daily and lifetime counts, several mantras, no double counting', () => {
  const events = [ev('s1', '2026-11-16', OM, 540, 1500), ev('s2', '2026-11-16', RAM, 216, 600), ev('s3', '2026-11-17', OM, 100, 200)];
  const days = C.buildDays(events);
  assert.equal(C.repsOfDay(days.get('2026-11-16')), 756);
  assert.equal(C.repsOfDay(days.get('2026-11-16'), OM), 540);
  assert.equal(C.repsOfDay(days.get('2026-11-17'), RAM), 0);
  const all = C.sumRange(days, '0000-01-01', '9999-12-31');
  assert.deepEqual([all.reps, all.malas, all.seconds, all.activeDays], [856, 7, 2300, 2]);
  // replaying the same absolute event (an offline retry) replaces, it does not add
  const store = new Map();
  const upsert = (e) => store.set(e.session_id + '|' + e.local_date, e);
  events.forEach(upsert); events.forEach(upsert); upsert(ev('s3', '2026-11-17', OM, 100, 200));
  assert.equal(C.sumRange(C.buildDays([...store.values()]), '0000-01-01', '9999-12-31').reps, 856);
});

test('malas: 108 completes one, counted per mantra per day', () => {
  const d = (n, m = OM) => C.buildDays([ev('s', '2026-11-17', m, n)]).get('2026-11-17');
  assert.equal(C.malasOfDay(d(107)), 0);
  assert.equal(C.malasOfDay(d(108)), 1);
  assert.equal(C.malasOfDay(d(215)), 1);
  assert.equal(C.malasOfDay(d(216)), 2);
  // 60 + 48 of the same mantra in two sittings is one mala; 60 of one and 48 of another is none
  const two = C.buildDays([ev('a', '2026-11-17', OM, 60), ev('b', '2026-11-17', OM, 48)]).get('2026-11-17');
  assert.equal(C.malasOfDay(two), 1);
  const mixed = C.buildDays([ev('a', '2026-11-17', OM, 60), ev('b', '2026-11-17', RAM, 48)]).get('2026-11-17');
  assert.equal(C.malasOfDay(mixed), 0);
  assert.equal(C.sessionTotals({ id: 'a' }, [ev('a', '2026-11-17', OM, 330)]).malas, 3);
});

test('a session that crosses midnight is split across the two days', () => {
  const b1 = { session_id: 's', local_date: '2026-11-16', mantra_id: OM, count: 0, seconds: 0 };
  const b2 = { session_id: 's', local_date: '2026-11-17', mantra_id: OM, count: 0, seconds: 0 };
  let t = Date.parse('2026-11-16T18:29:00Z'), last = 0;                     // 23:59 IST
  for (let i = 0; i < 30; i++) { C.applyTap(b1, 1, t, last); last = t; t += 2000; }
  for (let i = 0; i < 78; i++) { C.applyTap(b2, 1, t, last); last = t; t += 2000; }
  const days = C.buildDays([b1, b2]);
  assert.equal(C.repsOfDay(days.get('2026-11-16')), 30);
  assert.equal(C.repsOfDay(days.get('2026-11-17')), 78);
  assert.equal(C.sessionTotals({ id: 's' }, [b1, b2]).count, 108);
  assert.equal(C.sessionTotals({ id: 's' }, [b1, b2]).malas, 1);
  assert.equal(b1.seconds + b2.seconds, 107 * 2);
});

test('practice time ignores long pauses, undo never goes below zero', () => {
  const b = { count: 0, seconds: 0 };
  C.applyTap(b, 1, 1000_000, 0);
  C.applyTap(b, 1, 1000_000 + 3000, 1000_000);
  C.applyTap(b, 1, 1000_000 + 3000 + 20 * 60 * 1000, 1000_000 + 3000);     // 20-minute break
  assert.equal(b.count, 3);
  assert.equal(b.seconds, 3 + C.IDLE_CAP);
  C.applyTap(b, -1, 0, 0); C.applyTap(b, -1, 0, 0); C.applyTap(b, -1, 0, 0); C.applyTap(b, -1, 0, 0);
  assert.equal(b.count, 0);
});

test('date ranges', () => {
  const T = '2026-11-17';
  assert.deepEqual(C.rangeFor('today', T), { from: T, to: T });
  assert.deepEqual(C.rangeFor('7', T), { from: '2026-11-11', to: T });
  assert.deepEqual(C.rangeFor('30', T), { from: '2026-10-19', to: T });
  assert.deepEqual(C.rangeFor('90', T), { from: '2026-08-20', to: T });
  assert.deepEqual(C.rangeFor('year', T), { from: '2026-01-01', to: T });
  assert.deepEqual(C.rangeFor('all', T, '2025-04-02'), { from: '2025-04-02', to: T });
  assert.deepEqual(C.rangeFor('all', T, null), { from: T, to: T });
  assert.deepEqual(C.rangeFor('custom', T, null, { from: '2026-11-10', to: '2026-11-01' }), { from: '2026-11-01', to: '2026-11-10' });
  const days = C.buildDays([ev('a', '2026-11-10', OM, 108), ev('b', '2026-11-11', OM, 50), ev('c', T, OM, 25)]);
  assert.equal(C.overview(days, C.rangeFor('7', T), T).reps, 75);
  assert.equal(C.overview(days, C.rangeFor('30', T), T).reps, 183);
  assert.equal(C.overview(days, C.rangeFor('today', T), T).reps, 25);
});

test('series buckets by day, week or month and every metric adds up', () => {
  const events = []; let total = 0;
  for (let i = 0; i < 400; i++) { const n = (i * 37) % 300; total += n; events.push(ev('s' + i, C.addDays('2025-10-01', i), i % 2 ? OM : RAM, n, n * 2)); }
  const days = C.buildDays(events);
  for (const [from, to, size] of [['2026-10-19', '2026-11-04', 'day'], ['2026-01-01', '2026-11-04', 'week'], ['2023-01-01', '2026-11-04', 'month']]) {
    const s = C.series(days, { from, to }, 'reps');
    assert.equal(s.size, size);
    assert.equal(s.buckets.reduce((n, b) => n + b.reps, 0), C.sumRange(days, from, to).reps);
    assert.equal(C.series(days, { from, to }, 'malas').buckets.reduce((n, b) => n + b.value, 0), C.sumRange(days, from, to).malas);
    assert.equal(C.series(days, { from, to }, 'time').buckets.reduce((n, b) => n + b.value, 0), C.sumRange(days, from, to).seconds);
    s.buckets.forEach((b) => assert.equal(Object.values(b.byMantra).reduce((n, m) => n + m.count, 0), b.reps));
  }
  assert.equal(C.sumRange(days, '0000-01-01', '9999-12-31').reps, total);
  assert.equal(C.series(days, { from: '2026-10-19', to: '2026-10-25' }, 'reps', OM).buckets.reduce((n, b) => n + b.reps, 0), C.sumRange(days, '2026-10-19', '2026-10-25', OM).reps);
});

test('streaks: today may still be open; gaps break them', () => {
  const T = '2026-11-17';
  assert.equal(C.currentStreak(['2026-11-15', '2026-11-16', T], T), 3);
  assert.equal(C.currentStreak(['2026-11-15', '2026-11-16'], T), 2);         // not yet practised today
  assert.equal(C.currentStreak(['2026-11-14', '2026-11-15'], T), 0);
  assert.equal(C.currentStreak([], T), 0);
  const l = C.longestStreak(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06', '2026-02-27', '2026-02-28', '2026-03-01']);
  assert.deepEqual(l, { days: 3, from: '2026-01-04', to: '2026-01-06' });
  assert.equal(C.longestStreak(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']).days, 4);
});

test('goals: the spec example, and progress by mantra', () => {
  const T = '2026-11-17';
  const goals = [
    { id: 'g1', mantra_id: OM, goal_type: 'daily_malas', target_count: 5, effective_from: '2026-11-01', effective_until: null },
    { id: 'g2', mantra_id: RAM, goal_type: 'daily_malas', target_count: 2, effective_from: '2026-11-01', effective_until: null },
  ];
  const days = C.buildDays([ev('a', T, OM, 324), ev('b', T, RAM, 216)]);
  const p = C.goalProgress(goals[0], days, T);
  assert.deepEqual([p.done, p.target, p.targetReps, p.met], [3, 5, 540, false]);   // "3 of your 5 malas"
  assert.equal(C.goalProgress(goals[1], days, T).met, true);
  assert.equal(C.dayGoalsMet(goals, days, T), false);
  const full = C.buildDays([ev('a', T, OM, 540), ev('b', T, RAM, 216)]);
  assert.equal(C.dayGoalsMet(goals, full, T), true);
  assert.equal(C.dayGoalsMet([], full, T), null);
});

test('goals: weekly malas, monthly repetitions and an overall goal', () => {
  const T = '2026-11-18';                                                     // Wednesday
  const days = C.buildDays([ev('a', '2026-11-15', OM, 1080), ev('b', '2026-11-16', OM, 216), ev('c', '2026-11-17', RAM, 108), ev('d', T, OM, 100)]);
  const wk = C.goalProgress({ mantra_id: null, goal_type: 'weekly_malas', target_count: 4, effective_from: '2026-01-01' }, days, T);
  assert.deepEqual([wk.period.from, wk.period.to, wk.done, wk.met], ['2026-11-16', '2026-11-22', 3, false]);   // Sunday the 15th is last week
  const mo = C.goalProgress({ mantra_id: OM, goal_type: 'monthly_reps', target_count: 1000, effective_from: '2026-01-01' }, days, T);
  assert.deepEqual([mo.period.from, mo.period.to, mo.done, mo.met], ['2026-11-01', '2026-11-30', 1396, true]);
  const all = C.goalProgress({ mantra_id: null, goal_type: 'daily_reps', target_count: 300, effective_from: '2026-01-01' }, days, '2026-11-16');
  assert.deepEqual([all.done, all.met], [216, false]);
});

test('changing a goal keeps history: old days are judged by the old goal', () => {
  let goals = [{ id: 'g1', mantra_id: OM, goal_type: 'daily_malas', target_count: 1, effective_from: '2026-11-01', effective_until: null }];
  const days = C.buildDays([ev('a', '2026-11-10', OM, 108), ev('b', '2026-11-16', OM, 108), ev('c', '2026-11-17', OM, 108)]);
  assert.equal(C.dayGoalsMet(goals, days, '2026-11-10'), true);
  const plan = C.planGoalChange(goals, 'daily_malas', OM, 5, '2026-11-17');
  assert.deepEqual(plan.close, [{ id: 'g1', effective_until: '2026-11-16' }]);
  assert.deepEqual(plan.insert, { mantra_id: OM, goal_type: 'daily_malas', target_count: 5, effective_from: '2026-11-17', effective_until: null });
  goals = [{ ...goals[0], effective_until: '2026-11-16' }, { id: 'g2', ...plan.insert }];
  assert.equal(C.dayGoalsMet(goals, days, '2026-11-10'), true);              // still achieved
  assert.equal(C.dayGoalsMet(goals, days, '2026-11-16'), true);
  assert.equal(C.dayGoalsMet(goals, days, '2026-11-17'), false);             // judged by the new goal
  assert.equal(C.goalOn(goals, 'daily_malas', OM, '2026-11-05').target_count, 1);
  assert.equal(C.goalOn(goals, 'daily_malas', OM, '2026-11-20').target_count, 5);
  assert.deepEqual(C.goalDays(goals, days, '2026-11-15', '2026-11-17'), { total: 3, met: 1, pct: 33 });
  // a second change the same day edits in place; clearing a goal set today removes it; no change is a no-op
  assert.deepEqual(C.planGoalChange(goals, 'daily_malas', OM, 3, '2026-11-17').update, { id: 'g2', target_count: 3 });
  assert.deepEqual(C.planGoalChange(goals, 'daily_malas', OM, 0, '2026-11-17').remove, ['g2']);
  const none = C.planGoalChange(goals, 'daily_malas', OM, 5, '2026-11-17');
  assert.deepEqual([none.close.length, none.insert, none.update], [0, null, null]);
  // removing an older goal closes it yesterday, so its achievements remain
  const end = C.planGoalChange(goals, 'daily_malas', OM, 0, '2026-11-20');
  assert.deepEqual([end.close, end.insert], [[{ id: 'g2', effective_until: '2026-11-19' }], null]);
});

test('correcting and deleting a session recalculates everything', () => {
  let events = [ev('s1', '2026-11-16', OM, 100), ev('s1', '2026-11-17', OM, 60), ev('s2', '2026-11-17', OM, 108)];
  let r = C.redistribute(events.filter((e) => e.session_id === 's1'), 120);
  assert.deepEqual(r.map((b) => b.count), [100, 20]);
  r = C.redistribute(events.filter((e) => e.session_id === 's1'), 40);
  assert.deepEqual(r.map((b) => b.count), [40, 0]);
  r = C.redistribute(events.filter((e) => e.session_id === 's1'), 500);
  assert.deepEqual(r.map((b) => b.count), [100, 400]);
  assert.equal(C.milestones(events, []).items[0].achieved, true);            // 268 ≥ 108
  events = events.filter((e) => e.session_id !== 's2').map((e) => (e.local_date === '2026-11-17' ? { ...e, count: 0 } : e));
  const ms = C.milestones(events, []);
  assert.equal(ms.total, 100);
  assert.equal(ms.items[0].achieved, false);                                 // milestone withdrawn
  assert.equal(C.records(C.buildDays(events), [{ id: 's1', mantra_id: OM }], events).bestDay.reps, 100);
});

test('milestones: dates reached, custom ones, per mantra', () => {
  const events = [ev('a', '2026-01-01', OM, 100), ev('b', '2026-01-02', RAM, 8), ev('c', '2026-01-05', OM, 900), ev('d', '2026-02-01', OM, 9000)];
  const ms = C.milestones(events, [500, 20000]);
  const by = Object.fromEntries(ms.items.map((i) => [i.count, i]));
  assert.equal(ms.total, 10008);
  assert.equal(by[108].date, '2026-01-02');
  assert.equal(by[500].date, '2026-01-05');
  assert.equal(by[500].custom, true);
  assert.equal(by[1008].date, '2026-01-05');
  assert.equal(by[10008].date, '2026-02-01');
  assert.equal(by[20000].achieved, false);
  assert.equal(Math.round(by[20000].frac * 1000), 500);
  assert.equal(by[100008].achieved, false);
  assert.equal(C.milestones(events, [], RAM).items[0].achieved, false);
});

test('personal records', () => {
  const events = [ev('a', '2026-01-01', OM, 540, 1800), ev('b', '2026-01-01', RAM, 216, 500), ev('c', '2026-01-02', OM, 1100, 4000), ev('m', '2026-01-03', OM, 2000, 0)];
  const sessions = [{ id: 'a', mantra_id: OM }, { id: 'b', mantra_id: RAM }, { id: 'c', mantra_id: OM }, { id: 'm', mantra_id: OM, source: 'manual' }];
  const r = C.records(C.buildDays(events), sessions, events);
  assert.deepEqual(r.bestDay, { reps: 2000, date: '2026-01-03' });
  assert.deepEqual([r.bestSession.malas, r.bestSession.date], [18, '2026-01-03']);
  assert.deepEqual([r.longestSession.seconds, r.longestSession.date], [4000, '2026-01-02']);
  assert.equal(r.longestStreak.days, 3);
  assert.deepEqual(r.bestMalaDay, { malas: 18, date: '2026-01-03' });
});

test('mantra-wise statistics', () => {
  const T = '2026-11-18';
  const events = [ev('a', '2026-10-30', OM, 108), ev('b', '2026-11-02', OM, 216), ev('c', '2026-11-16', OM, 108, 300), ev('d', '2026-11-17', OM, 108, 300), ev('e', T, OM, 54, 100), ev('f', T, RAM, 999)];
  const goals = [{ id: 'g', mantra_id: OM, goal_type: 'daily_reps', target_count: 108, effective_from: '2026-11-16', effective_until: null }];
  const s = C.mantraStats(OM, C.buildDays(events), goals, T);
  assert.deepEqual([s.today, s.week, s.month, s.lifetime, s.malas, s.seconds], [54, 270, 486, 594, 5, 700]);
  assert.equal(s.lastPracticed, T);
  assert.equal(s.longestStreak.days, 3);
  assert.deepEqual([s.todayGoals[0].done, s.todayGoals[0].met], [54, false]);
  assert.deepEqual(s.goalDays30, { total: 3, met: 2, pct: 67 });
  assert.equal(C.mantraStats('none', C.buildDays(events), goals, T).lastPracticed, null);
});

test('consistency figures', () => {
  const T = '2026-11-17';
  const events = [], sessions = [];
  for (let i = 0; i < 10; i++) { const d = C.addDays(T, -i); events.push(ev('s' + i, d, OM, 200, 600, d + 'T00:45:00Z')); sessions.push({ id: 's' + i, mantra_id: OM, started_at: d + 'T00:45:00Z' }); }
  const goals = [{ id: 'g', mantra_id: null, goal_type: 'daily_reps', target_count: 150, effective_from: C.addDays(T, -4), effective_until: null }];
  const c = C.consistency(C.buildDays(events), goals, sessions, events, C.rangeFor('30', T), T, () => 6);
  assert.equal(c.daysThisMonth, 10);
  assert.equal(c.currentStreak, 10);
  assert.equal(c.avgRepsPerActiveDay, 200);
  assert.equal(c.avgSessionSeconds, 600);
  assert.deepEqual(c.goalDays, { total: 5, met: 5, pct: 100 });
  assert.equal(c.practiceTime.label, 'in the early morning');
});

test('insights appear only with enough data, and the arithmetic is right', () => {
  const T = '2026-11-17';
  const hour = () => 6;
  assert.deepEqual(C.trends(C.buildDays([]), [], [], [], T, {}, hour), []);
  const thin = [ev('a', T, OM, 500), ev('b', C.addDays(T, -8), OM, 100)];
  assert.deepEqual(C.trends(C.buildDays(thin), [], [], thin, T, {}, hour), []);       // one day each week is not a trend
  const events = [];
  for (let i = 0; i < 7; i++) events.push(ev('n' + i, C.addDays(T, -i), OM, 118));     // this week: 826
  for (let i = 7; i < 14; i++) events.push(ev('o' + i, C.addDays(T, -i), OM, 100));    // last week: 700
  const t = C.trends(C.buildDays(events), [], [], events, T, { [OM]: 'Om Namah Shivaya' }, hour);
  assert.equal(t.find((x) => x.kind === 'week').text, 'Your average daily Jaap increased by 18% compared with last week.');
  assert.equal(t.find((x) => x.kind === 'sankalpa'), undefined);                      // no goal set → no Sankalpa line
  const goals = [{ id: 'g', mantra_id: null, goal_type: 'daily_reps', target_count: 110, effective_from: '2026-11-01', effective_until: null }];
  const t2 = C.trends(C.buildDays(events), goals, [], events, T, {}, hour);
  assert.equal(t2.find((x) => x.kind === 'sankalpa').text, 'You completed your Sankalpa on 7 days this month.');
});

test('weekly summary numbers: "4,320 repetitions across 6 days"', () => {
  const events = [];
  for (let i = 0; i < 6; i++) events.push(ev('w' + i, C.addDays('2026-11-09', i), OM, 720));
  const s = C.sumRange(C.buildDays(events), '2026-11-09', '2026-11-15');
  assert.deepEqual([s.reps, s.activeDays, s.malas], [4320, 6, 36]);
  assert.equal(C.fmtNum(s.reps), '4,320');
});

test('heatmap and distribution', () => {
  const days = C.buildDays([ev('a', '2026-11-10', OM, 100), ev('b', '2026-11-11', OM, 400), ev('c', '2026-11-12', RAM, 250)]);
  const h = C.heatmap(days, '2026-11-01', '2026-11-17');
  assert.equal(h.max, 400);
  assert.ok(h.weeks.every((w) => w.length === 7));
  const cell = (d) => h.weeks.flat().find((c) => c.date === d);
  assert.deepEqual([cell('2026-11-10').level, cell('2026-11-11').level, cell('2026-11-12').level, cell('2026-11-13').level], [1, 4, 3, 0]);
  assert.equal(cell('2026-10-28').level, -1);                                // outside the range
  const dist = C.distribution(days, { from: '2026-11-01', to: '2026-11-17' });
  assert.deepEqual(dist.map((d) => [d.mantra_id, d.reps]), [[OM, 500], [RAM, 250]]);
  assert.equal(Math.round(dist[0].share * 100), 67);
});

test('reminder schedule: day of week, time window', () => {
  const r = { enabled: true, scheduled_time: '06:00:00', days_of_week: [1, 2, 3, 4, 5] };
  assert.equal(C.reminderDue(r, '2026-11-17', 2, 6 * 60, 60), true);
  assert.equal(C.reminderDue(r, '2026-11-17', 2, 6 * 60 + 59, 60), true);
  assert.equal(C.reminderDue(r, '2026-11-17', 2, 7 * 60, 60), false);        // too late: skipped, not sent hours afterwards
  assert.equal(C.reminderDue(r, '2026-11-17', 2, 5 * 60 + 59, 60), false);
  assert.equal(C.reminderDue(r, '2026-11-15', 0, 6 * 60, 60), false);        // Sunday not selected
  assert.equal(C.reminderDue({ ...r, enabled: false }, '2026-11-17', 2, 6 * 60, 60), false);
});

test('durations', () => {
  assert.equal(C.fmtDuration(45), '45s');
  assert.equal(C.fmtDuration(600), '10m');
  assert.equal(C.fmtDuration(3600), '1h');
  assert.equal(C.fmtDuration(5400), '1h 30m');
});
