import { useState, useEffect, useCallback } from 'react';
import {
  listUsers, updateProfile, deleteUser,
  getSchedule, deleteScheduleSlot, addScheduleSlot, updateScheduleSlot,
  startSession, stopSession, pauseSession, resumeSession,
  getActiveSession, getSessionsByDate, getSessionDetail,
  getDailyLeaderboard, getWeeklyLeaderboard, getMonthlyLeaderboard,
  startDemo, stopDemo,
} from '../api';
import type { UserProfile, SessionScheduleSlot } from '../types';

type Tab = 'users' | 'schedule' | 'sessions' | 'leaderboards';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Admin() {
  const [tab, setTab] = useState<Tab>('sessions');

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-accent">Pulse</span>Board
            <span className="text-text-dim font-normal text-lg ml-3">Admin</span>
          </h1>
        </div>
        <a
          href="/"
          className="px-4 py-2 rounded-xl text-sm font-semibold border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors"
        >
          ← Dashboard
        </a>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1 border border-border w-fit">
        {(['sessions', 'schedule', 'leaderboards', 'users'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors capitalize ${
              tab === t
                ? 'bg-accent text-white'
                : 'text-text-dim hover:text-text'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersPanel />}
      {tab === 'schedule' && <SchedulePanel />}
      {tab === 'sessions' && <SessionPanel />}
      {tab === 'leaderboards' && <LeaderboardsPanel />}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Sessions Panel
// ════════════════════════════════════════════════════════════════════

function SessionPanel() {
  const [session, setSession] = useState<{
    active: boolean;
    session_id?: string;
    session_name?: string;
    elapsed_seconds?: number;
    paused?: boolean;
    leaderboard?: Array<{
      rank: number; user_name: string; score: number;
      heart_rate: number; zone_color: string; power: number | null;
    }>;
  } | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [loading, setLoading] = useState(true);

  // Session history state
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10));
  const [historySessions, setHistorySessions] = useState<Array<{
    id: string; name: string; created_at: string; ended_at: string | null;
    active: boolean; scheduled: boolean;
  }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<{
    session: { id: string; name: string; created_at: string; ended_at: string | null };
    scores: Array<{
      user_name: string; total_score: number;
      zone_seconds: Record<string, number>;
      avg_power: number | null; peak_hr: number;
    }>;
  } | null>(null);

  const zoneColors = ['#94A3B8', '#3B82F6', '#22C55E', '#F97316', '#EF4444'];

  const refresh = useCallback(async () => {
    try {
      const data = await getActiveSession();
      setSession(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleStart() {
    await startSession(sessionName);
    setSessionName('');
    await refresh();
  }

  async function handleStop() {
    await stopSession();
    await refresh();
  }

  async function handlePause() {
    if (session?.paused) {
      await resumeSession();
    } else {
      await pauseSession();
    }
    await refresh();
  }

  async function handleDemoStart() {
    await startDemo();
    await refresh();
  }

  async function handleDemoStop() {
    await stopDemo();
    await refresh();
  }

  async function loadHistory(date: string) {
    setHistoryLoading(true);
    try {
      const sessions = await getSessionsByDate(date);
      setHistorySessions(sessions);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }

  useEffect(() => { loadHistory(historyDate); }, [historyDate]);

  async function toggleSessionDetail(sessionId: string) {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      setSessionDetail(null);
      return;
    }
    setExpandedSessionId(sessionId);
    try {
      const detail = await getSessionDetail(sessionId);
      setSessionDetail(detail);
    } catch {
      setSessionDetail(null);
    }
  }

  if (loading) return <div className="text-text-dim">Loading…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Current Session
        </h3>

        {session?.active ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
              <span className="font-semibold text-lg">{session.session_name || 'Active'}</span>
              <span
                className="text-text-dim text-sm tabular-nums"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {Math.floor((session.elapsed_seconds || 0) / 60)}:{((session.elapsed_seconds || 0) % 60).toString().padStart(2, '0')}
              </span>
              {session.paused && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                  Paused
                </span>
              )}
            </div>

            {/* Live leaderboard preview */}
            {session.leaderboard && session.leaderboard.length > 0 && (
              <div className="rounded-xl bg-surface-alt border border-border/50 p-3">
                <div className="text-xs text-text-dim uppercase tracking-wider mb-2 font-semibold">
                  Live Leaderboard
                </div>
                <div className="space-y-1">
                  {session.leaderboard.slice(0, 5).map((e) => (
                    <div key={e.rank} className="flex items-center gap-3 text-sm">
                      <span className="w-6 text-center font-mono text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                        {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `#${e.rank}`}
                      </span>
                      <span className="flex-1 truncate font-medium">{e.user_name}</span>
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: e.zone_color }}
                      />
                      <span className="font-mono text-text-dim text-xs tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                        {e.heart_rate > 0 ? `${e.heart_rate}bpm` : ''}
                      </span>
                      <span className="font-mono font-bold tabular-nums w-16 text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Math.round(e.score).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handlePause}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                {session.paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                ⏹ Stop Session
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-text-dim text-sm">No active session. Start one manually or wait for the schedule.</p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">Session name (optional)</label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Morning class"
                  className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-text text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <button
                onClick={handleStart}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/80 transition-colors"
              >
                ▶ Start Session
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Demo controls */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3
          className="text-lg font-semibold mb-3"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Demo Mode
        </h3>
        <p className="text-text-dim text-sm mb-4">
          Simulate 8 users with live HR/power data and scoring.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleDemoStart}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
          >
            Start Demo
          </button>
          <button
            onClick={handleDemoStop}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-border text-text-dim hover:text-red-400 hover:border-red-500/30 transition-colors"
          >
            Stop Demo
          </button>
        </div>
      </div>

      {/* Session History */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Session History
        </h3>

        <div className="mb-4">
          <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={historyDate}
            onChange={(e) => { setHistoryDate(e.target.value); setExpandedSessionId(null); setSessionDetail(null); }}
            className="bg-surface-alt border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
        </div>

        {historyLoading ? (
          <div className="text-text-dim text-sm py-4 text-center">Loading…</div>
        ) : historySessions.filter(s => !s.active).length === 0 ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-2 opacity-20">📋</div>
            <p className="text-text-dim text-sm">No completed sessions on this date.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {historySessions
              .filter(s => !s.active)
              .map((s) => {
                const startTime = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                const endTime = s.ended_at ? new Date(s.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                const isExpanded = expandedSessionId === s.id;

                return (
                  <div key={s.id} className="rounded-xl border border-border bg-surface-alt overflow-hidden">
                    <button
                      onClick={() => toggleSessionDetail(s.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">{s.name || s.id}</span>
                        {s.scheduled && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                            Scheduled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-text-dim text-xs">
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{startTime} → {endTime}</span>
                        <span className="text-lg leading-none">{isExpanded ? '▾' : '▸'}</span>
                      </div>
                    </button>

                    {isExpanded && sessionDetail && sessionDetail.session.id === s.id && (
                      <div className="border-t border-border px-4 py-3">
                        {sessionDetail.scores.length === 0 ? (
                          <p className="text-text-dim text-sm text-center py-2">No participant data.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-[30px_1fr_80px_100px_70px] gap-2 text-text-dim text-[10px] uppercase tracking-wider font-semibold mb-2">
                              <div>#</div>
                              <div>Name</div>
                              <div className="text-right">Score</div>
                              <div>Zones</div>
                              <div className="text-right">Peak HR</div>
                            </div>
                            {sessionDetail.scores
                              .sort((a, b) => b.total_score - a.total_score)
                              .map((sc, i) => {
                                const totalZone = Object.values(sc.zone_seconds).reduce((a, b) => a + b, 0);
                                return (
                                  <div key={i} className="grid grid-cols-[30px_1fr_80px_100px_70px] gap-2 py-1.5 items-center border-b border-border/30 last:border-0">
                                    <div className="text-text-dim text-xs font-bold">
                                      {i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}
                                    </div>
                                    <div className="text-sm font-medium truncate">{sc.user_name}</div>
                                    <div className="text-right font-bold tabular-nums text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                                      {Math.round(sc.total_score).toLocaleString()}
                                    </div>
                                    <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                                      {[1, 2, 3, 4, 5].map((z) => {
                                        const secs = sc.zone_seconds[String(z)] || 0;
                                        const pct = totalZone > 0 ? (secs / totalZone) * 100 : 0;
                                        return pct > 0 ? (
                                          <div key={z} className="h-full" style={{ width: `${pct}%`, background: zoneColors[z - 1] }} />
                                        ) : null;
                                      })}
                                    </div>
                                    <div className="text-right text-xs tabular-nums text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
                                      {sc.peak_hr > 0 ? sc.peak_hr : '—'}
                                    </div>
                                  </div>
                                );
                              })}
                            <div className="mt-2 text-text-dim text-xs text-right">
                              {sessionDetail.scores.length} participant{sessionDetail.scores.length !== 1 ? 's' : ''}
                              {sessionDetail.scores.length > 0 && (
                                <> · Total: {Math.round(sessionDetail.scores.reduce((sum, s) => sum + s.total_score, 0)).toLocaleString()} pts</>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Schedule Panel
// ════════════════════════════════════════════════════════════════════

function SchedulePanel() {
  const [slots, setSlots] = useState<SessionScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDay, setNewDay] = useState(0);
  const [newStart, setNewStart] = useState('07:00');
  const [newEnd, setNewEnd] = useState('08:00');
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editDay, setEditDay] = useState(0);

  async function load() {
    try {
      const data = await getSchedule();
      setSlots(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    await addScheduleSlot({ day_of_week: newDay, start_time: newStart, end_time: newEnd, active: true });
    await load();
  }

  async function handleDelete(id: string) {
    await deleteScheduleSlot(id);
    setEditingSlotId(null);
    await load();
  }

  function startSlotEdit(slot: SessionScheduleSlot) {
    setEditingSlotId(slot.id);
    setEditStart(slot.start_time);
    setEditEnd(slot.end_time);
    setEditDay(slot.day_of_week);
  }

  async function saveSlotEdit() {
    if (!editingSlotId) return;
    await updateScheduleSlot(editingSlotId, {
      day_of_week: editDay,
      start_time: editStart,
      end_time: editEnd,
    });
    setEditingSlotId(null);
    await load();
  }

  if (loading) return <div className="text-text-dim">Loading…</div>;

  // Group by day
  const byDay: Record<number, SessionScheduleSlot[]> = {};
  for (let d = 0; d < 7; d++) byDay[d] = [];
  for (const s of slots) {
    (byDay[s.day_of_week] ??= []).push(s);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Schedule grid */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Session Schedule
        </h3>
        <div className="grid grid-cols-7 gap-2">
          {DAY_NAMES.map((name, day) => (
            <div key={day}>
              <div className="text-xs text-text-dim uppercase tracking-wider text-center mb-2 font-semibold">
                {name}
              </div>
              <div className="space-y-1">
                {byDay[day]
                  .sort((a, b) => a.start_time.localeCompare(b.start_time))
                  .map((slot) => (
                    editingSlotId === slot.id ? (
                      <div
                        key={slot.id}
                        className="text-[11px] px-1 py-1.5 rounded-lg bg-accent/20 border-2 border-accent/50 space-y-1"
                      >
                        <select
                          value={editDay}
                          onChange={(e) => setEditDay(Number(e.target.value))}
                          className="w-full bg-surface-alt border border-border rounded px-1 py-0.5 text-[10px] text-text focus:outline-none focus:border-accent"
                        >
                          {DAY_NAMES.map((n, i) => (
                            <option key={i} value={i}>{n}</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                          className="w-full bg-surface-alt border border-border rounded px-1 py-0.5 text-[10px] text-text focus:outline-none focus:border-accent"
                        />
                        <input
                          type="time"
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                          className="w-full bg-surface-alt border border-border rounded px-1 py-0.5 text-[10px] text-text focus:outline-none focus:border-accent"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={saveSlotEdit}
                            className="flex-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-accent text-white hover:bg-accent/80 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingSlotId(null)}
                            className="flex-1 px-1 py-0.5 rounded text-[9px] font-semibold border border-border text-text-dim hover:text-text transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                        <button
                          onClick={() => handleDelete(slot.id)}
                          className="w-full px-1 py-0.5 rounded text-[9px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div
                        key={slot.id}
                        onClick={() => startSlotEdit(slot)}
                        className="group relative text-[11px] font-mono tabular-nums px-2 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-center cursor-pointer hover:bg-accent/20 transition-colors"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {slot.start_time}
                        <br />
                        {slot.end_time}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(slot.id); }}
                          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    )
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add slot */}
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Add Time Slot
        </h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">Day</label>
            <select
              value={newDay}
              onChange={(e) => setNewDay(Number(e.target.value))}
              className="bg-surface-alt border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            >
              {DAY_NAMES.map((n, i) => (
                <option key={i} value={i}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">Start</label>
            <input
              type="time"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              className="bg-surface-alt border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">End</label>
            <input
              type="time"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              className="bg-surface-alt border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={handleAdd}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/80 transition-colors"
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Leaderboards Panel
// ════════════════════════════════════════════════════════════════════

function LeaderboardsPanel() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<{
    combined?: Array<{
      rank: number; user_name: string; total_score: number;
      sessions_count: number; zone_seconds: Record<string, number>;
      avg_power: number | null; peak_hr: number;
    }>;
    sessions?: Array<{
      session_id: string; session_name: string; created_at: string;
      scores: Array<{
        user_name: string; total_score: number;
        zone_seconds: Record<string, number>;
      }>;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      let result;
      if (period === 'daily') {
        result = await getDailyLeaderboard(date);
      } else if (period === 'weekly') {
        result = await getWeeklyLeaderboard(date);
      } else {
        const d = new Date(date);
        result = await getMonthlyLeaderboard(d.getFullYear(), d.getMonth() + 1);
      }
      setData(result);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [period, date]);

  const zoneColors = ['#94A3B8', '#3B82F6', '#22C55E', '#F97316', '#EF4444'];

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Controls */}
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-xs text-text-dim mb-1 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-surface-alt border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-1 bg-surface rounded-xl p-1 border border-border">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold capitalize transition-colors ${
                period === p ? 'bg-accent text-white' : 'text-text-dim hover:text-text'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Combined leaderboard */}
      {loading ? (
        <div className="text-text-dim py-8 text-center">Loading…</div>
      ) : data?.combined && data.combined.length > 0 ? (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="grid grid-cols-[50px_1fr_80px_100px_120px_80px] gap-2 px-5 py-3 border-b border-border text-text-dim text-xs font-semibold uppercase tracking-wider">
            <div>Rank</div>
            <div>Name</div>
            <div className="text-right">Score</div>
            <div className="text-right">Sessions</div>
            <div>Zones</div>
            <div className="text-right">Peak HR</div>
          </div>
          {data.combined.map((entry) => {
            const totalZone = Object.values(entry.zone_seconds).reduce((a: number, b: number) => a + b, 0);
            return (
              <div
                key={entry.rank}
                className="grid grid-cols-[50px_1fr_80px_100px_120px_80px] gap-2 px-5 py-3 border-b border-border/50 last:border-b-0 items-center hover:bg-surface-alt/50 transition-colors"
              >
                <div className="font-bold">
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                </div>
                <div className="font-medium truncate">{entry.user_name}</div>
                <div
                  className="text-right font-bold tabular-nums"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {Math.round(entry.total_score).toLocaleString()}
                </div>
                <div className="text-right text-text-dim text-sm">{entry.sessions_count}</div>
                <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                  {[1, 2, 3, 4, 5].map((z) => {
                    const secs = entry.zone_seconds[String(z)] || 0;
                    const pct = totalZone > 0 ? (secs / totalZone) * 100 : 0;
                    return pct > 0 ? (
                      <div
                        key={z}
                        className="h-full"
                        style={{ width: `${pct}%`, background: zoneColors[z - 1] }}
                      />
                    ) : null;
                  })}
                </div>
                <div
                  className="text-right text-sm tabular-nums text-text-dim"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {entry.peak_hr > 0 ? entry.peak_hr : '—'}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="text-4xl mb-3 opacity-20">📊</div>
          <p className="text-text-dim text-sm">No leaderboard data for this {period} period.</p>
        </div>
      )}

      {/* Per-session breakdown (daily only) */}
      {period === 'daily' && data?.sessions && data.sessions.length > 0 && (
        <div className="space-y-3">
          <h3
            className="text-base font-semibold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Session Breakdown
          </h3>
          {data.sessions.map((s) => (
            <details
              key={s.session_id}
              className="rounded-xl border border-border bg-surface overflow-hidden"
            >
              <summary className="px-5 py-3 cursor-pointer hover:bg-surface-alt/50 transition-colors flex items-center justify-between">
                <span className="font-medium">{s.session_name || s.session_id}</span>
                <span className="text-text-dim text-xs">
                  {s.scores.length} participant{s.scores.length !== 1 ? 's' : ''}
                </span>
              </summary>
              <div className="px-5 pb-3 space-y-1">
                {s.scores
                  .sort((a, b) => b.total_score - a.total_score)
                  .map((sc, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm py-1">
                      <span className="w-6 text-center text-text-dim">{i + 1}</span>
                      <span className="flex-1 truncate">{sc.user_name}</span>
                      <span
                        className="font-mono font-bold tabular-nums"
                        style={{ fontFamily: 'var(--font-mono)' }}
                      >
                        {Math.round(sc.total_score).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Users Panel (existing, refactored into subcomponent)
// ════════════════════════════════════════════════════════════════════

function UsersPanel() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editMaxHr, setEditMaxHr] = useState(190);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const data = await listUsers();
      setUsers(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  function startEdit(user: UserProfile) {
    setEditingId(user.id);
    setEditName(user.name);
    setEditEmail(user.email || '');
    setEditMaxHr(user.max_hr);
    setConfirmDeleteId(null);
  }

  async function saveEdit(userId: string) {
    await updateProfile(userId, editName, editMaxHr, editEmail);
    setEditingId(null);
    await loadUsers();
  }

  async function handleDelete(userId: string) {
    await deleteUser(userId);
    setConfirmDeleteId(null);
    await loadUsers();
  }

  if (loading) return <div className="text-text-dim">Loading…</div>;

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
        <div className="text-5xl mb-4 opacity-20">👤</div>
        <h2 className="text-xl font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          No registered users
        </h2>
        <p className="text-text-dim text-sm">
          Users will appear here after they register via the{' '}
          <a href="/register" className="text-accent hover:underline">Join</a> page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden max-w-5xl">
      <div className="grid grid-cols-[1fr_1fr_80px_1fr_140px] gap-4 px-5 py-3 border-b border-border text-text-dim text-xs font-semibold uppercase tracking-wider">
        <div>Name</div>
        <div>Email</div>
        <div>Max HR</div>
        <div>Device</div>
        <div className="text-right">Actions</div>
      </div>
      {users.map((user) => (
        <div
          key={user.id}
          className="grid grid-cols-[1fr_1fr_80px_1fr_140px] gap-4 px-5 py-3 border-b border-border/50 last:border-b-0 items-center hover:bg-surface-alt/50 transition-colors"
        >
          {editingId === user.id ? (
            <>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                autoFocus
              />
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="email@example.com"
              />
              <input
                type="number"
                value={editMaxHr}
                onChange={(e) => setEditMaxHr(Number(e.target.value))}
                className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent w-20"
                min={120}
                max={230}
              />
              <div className="text-text-dim text-sm truncate">
                {user.device_name || user.device_address || '—'}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => saveEdit(user.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/80 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-text-dim hover:text-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">{user.name}</div>
              <div className="text-text-dim text-sm truncate">{user.email || <span className="italic opacity-50">—</span>}</div>
              <div className="text-sm" style={{ fontFamily: 'var(--font-mono)' }}>{user.max_hr}</div>
              <div className="text-text-dim text-sm truncate">
                {user.device_name
                  ? user.device_name
                  : user.device_address
                    ? user.device_address
                    : <span className="italic opacity-50">No device</span>}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => startEdit(user)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-text-dim hover:text-accent hover:border-accent/30 transition-colors"
                >
                  Edit
                </button>
                {confirmDeleteId === user.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-text-dim hover:text-text transition-colors"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setConfirmDeleteId(user.id); setEditingId(null); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-text-dim hover:text-red-400 hover:border-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
