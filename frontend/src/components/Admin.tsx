import { useState, useEffect } from 'react';
import { listUsers, updateProfile, deleteUser } from '../api';
import type { UserProfile } from '../types';

export function Admin() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMaxHr, setEditMaxHr] = useState(190);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const data = await listUsers();
      setUsers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  function startEdit(user: UserProfile) {
    setEditingId(user.id);
    setEditName(user.name);
    setEditMaxHr(user.max_hr);
    setConfirmDeleteId(null);
  }

  async function saveEdit(userId: string) {
    await updateProfile(userId, editName, editMaxHr);
    setEditingId(null);
    await loadUsers();
  }

  async function handleDelete(userId: string) {
    await deleteUser(userId);
    setConfirmDeleteId(null);
    await loadUsers();
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-accent">Pulse</span>Board
            <span className="text-text-dim font-normal text-lg ml-3">Admin</span>
          </h1>
          <p className="text-text-dim text-sm mt-1">
            {users.length} registered user{users.length !== 1 ? 's' : ''}
          </p>
        </div>
        <a
          href="/"
          className="px-4 py-2 rounded-xl text-sm font-semibold border border-border text-text-dim hover:text-text hover:border-accent/30 transition-colors"
        >
          ← Dashboard
        </a>
      </header>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-text-dim">Loading…</div>
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
          <div className="text-5xl mb-4 opacity-20">👤</div>
          <h2
            className="text-xl font-semibold mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            No registered users
          </h2>
          <p className="text-text-dim text-sm">
            Users will appear here after they register via the{' '}
            <a href="/register" className="text-accent hover:underline">Join</a> page.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_1fr_140px] md:grid-cols-[1fr_100px_1fr_140px] gap-4 px-5 py-3 border-b border-border text-text-dim text-xs font-semibold uppercase tracking-wider">
            <div>Name</div>
            <div>Max HR</div>
            <div>Device</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Rows */}
          {users.map((user) => (
            <div
              key={user.id}
              className="grid grid-cols-[1fr_100px_1fr_140px] gap-4 px-5 py-3 border-b border-border/50 last:border-b-0 items-center hover:bg-surface-alt/50 transition-colors"
            >
              {editingId === user.id ? (
                <>
                  {/* Editing mode */}
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
                    autoFocus
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
                  {/* Display mode */}
                  <div className="font-medium">{user.name}</div>
                  <div
                    className="text-sm"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {user.max_hr}
                  </div>
                  <div className="text-text-dim text-sm truncate">
                    {user.device_name
                      ? `${user.device_name}`
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
      )}
    </div>
  );
}
