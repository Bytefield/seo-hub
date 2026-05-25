import { useState, useRef, useEffect } from 'react'
import { verifyPin, getUser } from '../lib/tauri'
import { useAppStore } from '../store/appStore'

export default function Login() {
  const [pin, setPin] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [shaking, setShaking] = useState(false)
  const inputs = useRef<HTMLInputElement[]>([])
  const { setUnlocked, setUser, user } = useAppStore()

  const pinLength = 4 // could be 4-8 based on what user set

  async function handleVerify(digits: string[]) {
    const code = digits.join('')
    if (code.length < pinLength) return
    try {
      const ok = await verifyPin(code)
      if (ok) {
        const u = await getUser()
        setUser(u)
        setUnlocked(true)
      } else {
        setShaking(true)
        setError('Wrong PIN')
        setPin(['', '', '', '', '', ''])
        inputs.current[0]?.focus()
        setTimeout(() => { setShaking(false); setError('') }, 600)
      }
    } catch (e) {
      setError(String(e))
    }
  }

  function handleInput(idx: number, val: string) {
    if (!/^\d?$/.test(val)) return
    const next = [...pin]
    next[idx] = val
    setPin(next)
    if (val && idx < pinLength - 1) inputs.current[idx + 1]?.focus()
    if (next.slice(0, pinLength).every(d => d !== '')) handleVerify(next)
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus()
    }
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center grid-bg overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 35% at 50% 50%, rgba(249,115,22,0.07) 0%, transparent 70%)' }} />

      {/* Corner decorations */}
      <div className="absolute top-6 left-6 w-8 h-8 border-l-2 border-t-2 border-[var(--b2)]" />
      <div className="absolute top-6 right-6 w-8 h-8 border-r-2 border-t-2 border-[var(--b2)]" />
      <div className="absolute bottom-6 left-6 w-8 h-8 border-l-2 border-b-2 border-[var(--b2)]" />
      <div className="absolute bottom-6 right-6 w-8 h-8 border-r-2 border-b-2 border-[var(--b2)]" />

      <div className="anim-up flex flex-col items-center gap-8 px-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full animate-[pulse-ring_2s_ease-out_infinite]"
              style={{ background: 'var(--accent)', opacity: 0.15 }} />
            <div className="relative w-16 h-16 flex items-center justify-center"
              style={{
                background: 'var(--s2)',
                border: '1px solid var(--b2)',
                clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
              }}>
              <span className="text-[var(--accent)] font-mono font-bold text-xl">S</span>
            </div>
          </div>
          <div className="text-center">
            <div className="font-display text-2xl text-[var(--t1)]">SYNIO <span className="text-[var(--accent)]">SEO</span></div>
            <div className="font-mono text-[11px] text-[var(--t3)] tracking-[0.2em] uppercase mt-1">
              {user?.name ?? 'Admin'} · Enter PIN
            </div>
          </div>
        </div>

        {/* PIN inputs */}
        <div
          className="flex gap-3"
          style={{ animation: shaking ? 'shake 0.4s ease' : undefined }}
        >
          {Array.from({ length: pinLength }).map((_, i) => (
            <input
              key={i}
              ref={el => { if (el) inputs.current[i] = el }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={pin[i]}
              onChange={e => handleInput(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              autoFocus={i === 0}
              className="w-12 h-14 text-center font-mono text-lg rounded-[var(--r)] outline-none transition-all duration-150"
              style={{
                background: pin[i] ? 'var(--adim)' : 'var(--s2)',
                border: `1px solid ${pin[i] ? 'var(--accent)' : 'var(--b2)'}`,
                color: 'var(--t1)',
                boxShadow: pin[i] ? '0 0 12px var(--aglow)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Error */}
        <div className="h-5 font-mono text-[12px] text-[var(--red)] text-center tracking-wide">
          {error}
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--t3)]">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]"
            style={{ animation: 'blink 2s infinite' }} />
          SYSTEM READY · LOCAL VAULT SECURED
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%    {transform:translateX(-8px)}
          40%    {transform:translateX(8px)}
          60%    {transform:translateX(-6px)}
          80%    {transform:translateX(6px)}
        }
      `}</style>
    </div>
  )
}
