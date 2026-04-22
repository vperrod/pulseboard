import { useState, useEffect } from 'react';
import { registerUser, claimDevice, getProfile, updateProfile } from '../api';
import type { UserProfile } from '../types';

type Step = 'form' | 'pair' | 'done';

const bleSupported =
  typeof navigator !== 'undefined' && navigator.bluetooth !== undefined;

export function Register() {
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [maxHr, setMaxHr] = useState(190);
  const [age, setAge] = useState('');
  const [userId, setUserId] = useState('');
  const [pairing, setPairing] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');

  // Check for returning user
  useEffect(() => {
    const stored = localStorage.getItem('pulseboard_user_id');
    if (stored) {
      getProfile(stored)
        .then((p: UserProfile) => {
          setProfile(p);
          setUserId(p.id);
          setName(p.name);
          setEmail(p.email || '');
          setMaxHr(p.max_hr);
          if (p.device_address) {
            setStep('done');
          }
        })
        .catch(() => localStorage.removeItem('pulseboard_user_id'));
    }
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const computedMaxHr = age ? 220 - parseInt(age) : maxHr;
    try {
      let p: UserProfile;
      if (userId) {
        p = await updateProfile(userId, name, computedMaxHr, email);
      } else {
        p = await registerUser(name, computedMaxHr, email);
      }
      setUserId(p.id);
      setProfile(p);
      localStorage.setItem('pulseboard_user_id', p.id);
      setStep('pair');
    } catch {
      setError('Registration failed. Please try again.');
    }
  }

  async function handlePairWatch() {
    if (!navigator.bluetooth) return;
    setPairing(true);
    setError('');
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      });
      const deviceName = device.name || 'HR Sensor';
      const deviceAddress = `web:${userId}`;
      const p = await claimDevice(userId, deviceAddress, deviceName);
      setProfile(p);
      setStep('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pairing failed';
      if (!msg.includes('cancel')) {
        setError(msg);
      }
    }
    setPairing(false);
  }

  function handleSkipPairing() {
    setStep('done');
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

              <div>
                <label className="block text-xs text-text-dim mb-1.5 uppercase tracking-wider">
                  Email <span className="text-text-dim/50">(optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-text focus:outline-none focus:border-accent transition-colors"
                  placeholder="alex@example.com"
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
              {userId ? 'Update & pair' : 'Next — pair your watch'}
            </button>
          </form>
        )}

        {/* Step 2: Pair your watch */}
        {step === 'pair' && (
          <div className="space-y-4">
            <div className="bg-surface rounded-2xl border border-border p-6">
              <h2
                className="text-lg font-semibold mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Pair your watch
              </h2>
              <p className="text-text-dim text-sm mb-5">
                Enable HR broadcast on your watch, then click below to find it.
              </p>

              {bleSupported ? (
                <button
                  onClick={handlePairWatch}
                  disabled={pairing}
                  className="w-full py-3 rounded-xl font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {pairing ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/40 border-t-white rounded-full" />
                      Pairing…
                    </>
                  ) : (
                    '⦿ Find watch via Bluetooth'
                  )}
                </button>
              ) : (
                <div className="text-center py-4 text-text-dim text-sm">
                  <p className="mb-2">Web Bluetooth not available in this browser.</p>
                  <p>Use <strong>Chrome</strong> on a laptop or Android.</p>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-text-dim text-xs mb-2">Using a Garmin watch?</p>
                <p className="text-text-dim text-[11px]">
                  Garmin doesn't support standard BLE HR streaming in browsers.
                  Run <code className="text-accent">scanner.py</code> on your laptop
                  instead — it will auto-connect your watch.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('form')}
                className="flex-1 py-2 text-sm text-text-dim hover:text-text transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleSkipPairing}
                className="flex-1 py-2 text-sm text-text-dim hover:text-accent transition-colors"
              >
                Skip — I'll use scanner.py →
              </button>
            </div>
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
                {profile.device_name
                  ? 'Your data will appear on the dashboard. Hit Connect Watch to start streaming.'
                  : 'Head to the dashboard and connect your watch, or run scanner.py.'}
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
