const BASE = '';

export async function registerUser(name: string, maxHr: number) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, max_hr: maxHr }),
  });
  return res.json();
}

export async function getProfile(userId: string) {
  const res = await fetch(`${BASE}/api/profile/${userId}`);
  return res.json();
}

export async function updateProfile(userId: string, name: string, maxHr: number) {
  const res = await fetch(`${BASE}/api/profile/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, max_hr: maxHr }),
  });
  return res.json();
}

export async function scanDevices() {
  const res = await fetch(`${BASE}/api/devices/scan`);
  return res.json();
}

export async function claimDevice(userId: string, deviceAddress: string, deviceName: string) {
  const res = await fetch(`${BASE}/api/devices/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, device_address: deviceAddress, device_name: deviceName }),
  });
  return res.json();
}

export async function listUsers(): Promise<import('./types').UserProfile[]> {
  const res = await fetch(`${BASE}/api/users`);
  return res.json();
}

export async function deleteUser(userId: string) {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  return res.json();
}

export async function webPushMetric(
  userId: string,
  heartRate: number,
  deviceName: string,
  power?: number,
) {
  const res = await fetch(`${BASE}/api/metrics/web-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      heart_rate: heartRate,
      device_name: deviceName,
      power: power ?? null,
    }),
  });
  return res.json();
}

// ── Session control ─────────────────────────────────────────────────

export async function startSession(name?: string) {
  const res = await fetch(`${BASE}/api/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || '' }),
  });
  return res.json();
}

export async function stopSession() {
  const res = await fetch(`${BASE}/api/sessions/stop`, { method: 'POST' });
  return res.json();
}

export async function pauseSession() {
  const res = await fetch(`${BASE}/api/sessions/pause`, { method: 'POST' });
  return res.json();
}

export async function resumeSession() {
  const res = await fetch(`${BASE}/api/sessions/resume`, { method: 'POST' });
  return res.json();
}

export async function getActiveSession() {
  const res = await fetch(`${BASE}/api/sessions/active`);
  return res.json();
}

// ── View mode ───────────────────────────────────────────────────────

export async function setViewMode(mode: string) {
  const res = await fetch(`${BASE}/api/view-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return res.json();
}

// ── Schedule ────────────────────────────────────────────────────────

export async function getSchedule() {
  const res = await fetch(`${BASE}/api/schedule`);
  return res.json();
}

export async function updateSchedule(slots: import('./types').SessionScheduleSlot[]) {
  const res = await fetch(`${BASE}/api/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slots),
  });
  return res.json();
}

export async function addScheduleSlot(slot: Partial<import('./types').SessionScheduleSlot>) {
  const res = await fetch(`${BASE}/api/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slot),
  });
  return res.json();
}

export async function deleteScheduleSlot(slotId: string) {
  const res = await fetch(`${BASE}/api/schedule/${encodeURIComponent(slotId)}`, { method: 'DELETE' });
  return res.json();
}

// ── Leaderboards ────────────────────────────────────────────────────

export async function getDailyLeaderboard(date?: string) {
  const params = date ? `?date=${date}` : '';
  const res = await fetch(`${BASE}/api/leaderboards/daily${params}`);
  return res.json();
}

export async function getWeeklyLeaderboard(date?: string) {
  const params = date ? `?date=${date}` : '';
  const res = await fetch(`${BASE}/api/leaderboards/weekly${params}`);
  return res.json();
}

export async function getMonthlyLeaderboard(year?: number, month?: number) {
  const params = year && month ? `?year=${year}&month=${month}` : '';
  const res = await fetch(`${BASE}/api/leaderboards/monthly${params}`);
  return res.json();
}

// ── Demo ────────────────────────────────────────────────────────────

export async function startDemo() {
  const res = await fetch(`${BASE}/api/demo/start`, { method: 'POST' });
  return res.json();
}

export async function stopDemo() {
  const res = await fetch(`${BASE}/api/demo/stop`, { method: 'POST' });
  return res.json();
}
