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
