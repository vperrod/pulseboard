import { useState, useEffect } from 'react';
import { registerUser, scanDevices, claimDevice, getProfile, updateProfile } from '../api';
import type { ScannedDevice, UserProfile } from '../types';

type Step = 'form' | 'scan' | 'done';

export function Register() {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [maxHr, setMaxHr] = useState(190);
  const [age, setAge] = useState('');
  const [userId, setUserId] = useState('');
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [showOnlyHR, setShowOnlyHR] = useState(true);

  // Check for returning user
  useEffect(() => {
    const stored = localStorage.getItem('pulseboard_user_id');
    if (stored) {
      getProfile(stored)
        .then((p: UserProfile) => {
          setProfile(p);
          setUserId(p.id);
          setName(p.name);
          setMaxHr(p.max_hr);
          if (p.device_address) {
            setStep('done');
          }
        })
        .catch(() => localStorage.removeItem('pulseboard_user_id'));
    }
  }, []);

  // Auto-refresh scan results every 3s when on the scan step
  useEffect(() => {
    if (step !== 'scan') return;
    const interval = setInterval(async () => {
      try {
        const devs: ScannedDevice[] = await scanDevices();
        setDevices(devs);
      } catch {
        // silently ignore refresh errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [step]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const computedMaxHr = age ? 220 - parseInt(age) : maxHr;
    try {
      let p: UserProfile;
      if (userId) {
        p = await updateProfile(userId, name, computedMaxHr);
      } else {
        p = await registerUser(name, computedMaxHr);
      }
      setUserId(p.id);
      setProfile(p);
      localStorage.setItem('pulseboard_user_id', p.id);
      setStep('done');
    } catch {
      setError('Registration failed. Please try again.');
    }
  }

  async function doScan() {
    setScanning(true);
    try {
      const devs: ScannedDevice[] = await scanDevices();
      setDevices(devs);
    } catch {
      setError('Scanning failed — is the BLE scanner running?');
    }
    setScanning(false);
  }

  async function handleClaim(device: ScannedDevice) {
    try {
      const p = await claimDevice(userId, device.address, device.name);
      setProfile(p);
      setStep('done');
    } catch {
      setError('Failed to claim device.');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-accent">Pulse</span>Board
          </h1>
          <p className="text-text-dim text-sm mt-1">Live workout metrics</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Name + Max HR */}
        {step === 'form' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="bg-surface rounded-2xl border border-border p-6 space-y-4">
              <h2
                className="text-lg font-semibold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {userId ? 'Update profile' : 'Join the board'}
              </h2>

              <div>
                <label className="block text-xs text-text-dim mb-1.5 uppercase tracking-wider">
                  Your name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-text focus:outline-none focus:border-accent transition-colors"
                  placeholder="e.g. Alex"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-dim mb-1.5 uppercase tracking-wider">
                    Age <span className="text-text-dim/50">(optional)</span>
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => {
                      setAge(e.target.value);
                      if (e.target.value) setMaxHr(220 - parseInt(e.target.value));
                    }}
                    className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-text focus:outline-none focus:border-accent transition-colors"
                    placeholder="30"
                    min="10"
                    max="100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-dim mb-1.5 uppercase tracking-wider">
                    Max HR
                  </label>
                  <input
                    type="number"
                    value={maxHr}
                    onChange={(e) => setMaxHr(parseInt(e.target.value) || 190)}
                    className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-text focus:outline-none focus:border-accent transition-colors"
                    min="100"
                    max="230"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl font-semibold text-white bg-accent hover:bg-accent/80 transition-colors"
            >
              {userId ? 'Update profile' : 'Register'}
            </button>
          </form>
        )}

        {/* Step 2: Pick your device */}
        {step === 'scan' && (
          <div className="space-y-4">
            <div className="bg-surface rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-lg font-semibold"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Select your device
                </h2>
                <button
                  onClick={doScan}
                  disabled={scanning}
                  className="text-xs text-accent hover:underline disabled:opacity-50"
                >
                  {scanning ? 'Scanning…' : 'Refresh'}
                </button>
              </div>

              <p className="text-text-dim text-sm mb-3">
                Make sure HR broadcast is enabled on your watch. Tap your device below.
              </p>

              <label className="flex items-center gap-2 text-sm text-text-dim cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={showOnlyHR}
                  onChange={(e) => setShowOnlyHR(e.target.checked)}
                  className="accent-accent"
                />
                Only show HR-capable devices
              </label>

              {devices.length === 0 && !scanning && (
                <div className="text-center py-8 text-text-dim text-sm">
                  <div className="text-3xl mb-2 opacity-30">📡</div>
                  No BLE devices found. Enable HR broadcast and tap Refresh.
                </div>
              )}

              {scanning && (
                <div className="text-center py-6 text-text-dim text-sm">
                  <div className="animate-spin inline-block h-5 w-5 border-2 border-accent/40 border-t-accent rounded-full mb-2" />
                  <div>Scanning nearby devices…</div>
                </div>
              )}

              <div className="space-y-2">
                {(showOnlyHR ? devices.filter(d => d.has_hr_service) : devices).map((d) => (
                  <button
                    key={d.address}
                    onClick={() => handleClaim(d)}
                    disabled={d.claimed_by !== null && d.claimed_by !== userId}
                    className={`
                      w-full text-left p-3 rounded-xl border transition-all
                      ${
                        d.claimed_by && d.claimed_by !== userId
                          ? 'border-border/50 opacity-40 cursor-not-allowed'
                          : 'border-border hover:border-accent/50 hover:bg-accent/5 cursor-pointer'
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-sm">{d.name || 'Unknown device'}</div>
                          {d.has_hr_service && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-400">
                              HR
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-dim font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                          {d.address}
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        {d.heart_rate_preview !== null && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-red-400 animate-pulse">♥</span>
                            <span className="font-mono text-lg font-bold tabular-nums text-red-400" style={{ fontFamily: 'var(--font-mono)' }}>
                              {d.heart_rate_preview}
                            </span>
                            <span className="text-[10px] text-text-dim font-mono">bpm</span>
                          </div>
                        )}
                        {d.heart_rate_preview === null && d.has_hr_service && (
                          <span className="text-xs text-text-dim">Connecting…</span>
                        )}
                        {d.rssi < 0 && (
                          <div className="text-xs text-text-dim">{d.rssi} dBm</div>
                        )}
                        {d.claimed_by && d.claimed_by !== userId && (
                          <div className="text-xs text-red-400">In use</div>
                        )}
                        {d.claimed_by === userId && (
                          <div className="text-xs text-green-400">Your device</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep('form')}
              className="w-full py-2 text-sm text-text-dim hover:text-text transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && profile && (
          <div className="space-y-4">
            <div className="bg-surface rounded-2xl border border-accent/30 p-6 text-center">
              <div className="text-4xl mb-3">✓</div>
              <h2
                className="text-xl font-semibold mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                You're all set, {profile.name}!
              </h2>
              <p className="text-text-dim text-sm mb-4">
                Head to the dashboard and connect your watch via Bluetooth.
              </p>

              {profile.device_name && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-sm">
                  <span className="h-2 w-2 rounded-full bg-zone-3" />
                  {profile.device_name}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <a
                href="/"
                className="flex-1 py-3 rounded-xl font-semibold text-center text-white bg-accent hover:bg-accent/80 transition-colors"
              >
                View dashboard
              </a>
              <button
                onClick={() => setStep('form')}
                className="px-4 py-3 rounded-xl border border-border text-text-dim hover:text-text transition-colors"
              >
                Edit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
