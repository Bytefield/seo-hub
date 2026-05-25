import { useState, useRef } from 'react'
import { User, Lock, Unlock, Save, CheckCircle, XCircle, AlertCircle, ExternalLink, Eye, EyeOff, TestTube, Trash2, Upload, Download, RefreshCw } from 'lucide-react'
import { updateUser, setPin, removePin, getAllCredentialStatuses, saveCredential, deleteCredential, testCredential, importServiceAccount } from '../lib/tauri'
import type { CredentialStatus, TestResult } from '../lib/tauri'
import { useAppStore } from '../store/appStore'

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

// ── Shared ────────────────────────────────────────────────────────────────

const Section = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="rounded-[var(--rl)] border overflow-hidden"
    style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
    <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--b1)', background: 'var(--s2)' }}>
      <div className="font-medium text-[17px] text-[var(--t1)]">{title}</div>
      <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">{sub}</div>
    </div>
    <div className="px-5 py-5">{children}</div>
  </div>
)

// ── Update checker ────────────────────────────────────────────────────────

type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'error'

function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateNotes, setUpdateNotes] = useState<string | null>(null)

  async function checkUpdate() {
    if (!IS_TAURI) return
    setStatus('checking')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        setUpdateVersion(update.version)
        setUpdateNotes(update.body ?? null)
        setStatus('available')
      } else {
        setStatus('uptodate')
        setTimeout(() => setStatus('idle'), 4000)
      }
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 5000)
    }
  }

  async function installUpdate() {
    if (!IS_TAURI) return
    setStatus('downloading')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) await update.downloadAndInstall()
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('available'), 4000)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={checkUpdate}
          disabled={status === 'checking' || status === 'downloading'}
          className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}
        >
          <RefreshCw size={12} className={status === 'checking' ? 'animate-spin' : ''} />
          {status === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>

        {status === 'uptodate' && (
          <span className="font-mono text-[11px] flex items-center gap-1.5" style={{ color: 'var(--green)' }}>
            <CheckCircle size={11} /> You are up to date
          </span>
        )}
        {status === 'error' && (
          <span className="font-mono text-[11px] flex items-center gap-1.5" style={{ color: 'var(--red)' }}>
            <XCircle size={11} /> Check failed — verify endpoint config
          </span>
        )}
      </div>

      {status === 'available' && updateVersion && (
        <div className="p-3 rounded-[var(--r)] border flex items-start justify-between gap-3"
          style={{ background: 'var(--gdim)', borderColor: 'rgba(16,217,160,0.25)' }}>
          <div>
            <div className="font-mono text-[12px] font-medium" style={{ color: 'var(--green)' }}>
              v{updateVersion} available
            </div>
            {updateNotes && (
              <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--t2)' }}>{updateNotes}</div>
            )}
          </div>
          <button
            onClick={installUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] font-mono text-[12px] font-medium text-white flex-shrink-0 transition-all hover:opacity-90"
            style={{ background: 'var(--green)' }}
          >
            <Download size={11} /> Install
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div className="font-mono text-[11px] flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
          <RefreshCw size={11} className="animate-spin" /> Downloading and installing…
        </div>
      )}
    </div>
  )
}

// ── General tab ───────────────────────────────────────────────────────────

function GeneralTab() {
  const { user, setUser } = useAppStore()
  const [name, setName] = useState(user?.name ?? '')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [nameMsg, setNameMsg] = useState('')
  const [pinMsg, setPinMsg] = useState('')

  async function handleSaveName() {
    if (!name.trim()) return
    setSavingName(true); setNameMsg('')
    try {
      const u = await updateUser(name)
      setUser(u)
      setNameMsg('Saved ✓')
    } catch (e) {
      setNameMsg(String(e))
    } finally {
      setSavingName(false)
      setTimeout(() => setNameMsg(''), 3000)
    }
  }

  async function handleSetPin() {
    if (newPin.length < 4) { setPinMsg('PIN must be at least 4 digits'); return }
    if (newPin !== confirmPin) { setPinMsg('PINs do not match'); return }
    setSavingPin(true); setPinMsg('')
    try {
      await setPin(newPin)
      setNewPin(''); setConfirmPin('')
      setPinMsg('PIN set successfully ✓')
      setUser({ ...user!, has_pin: true })
    } catch (e) {
      setPinMsg(String(e))
    } finally {
      setSavingPin(false)
      setTimeout(() => setPinMsg(''), 4000)
    }
  }

  async function handleRemovePin() {
    if (!currentPin) { setPinMsg('Enter current PIN to remove it'); return }
    setSavingPin(true); setPinMsg('')
    try {
      await removePin(currentPin)
      setCurrentPin('')
      setPinMsg('PIN removed ✓')
      setUser({ ...user!, has_pin: false })
    } catch (e) {
      setPinMsg(String(e))
    } finally {
      setSavingPin(false)
      setTimeout(() => setPinMsg(''), 4000)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Profile" sub="Your local user identity">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--adim)', border: '1px solid rgba(249,115,22,0.3)' }}>
            <User size={18} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">Name</label>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                className="flex-1 px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px]"
                style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }} />
              <button onClick={handleSaveName} disabled={savingName}
                className="px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
                style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}>
                <Save size={13} />
              </button>
            </div>
            {nameMsg && (
              <span className="font-mono text-[11px]"
                style={{ color: nameMsg.includes('✓') ? 'var(--green)' : 'var(--red)' }}>
                {nameMsg}
              </span>
            )}
          </div>
        </div>
      </Section>

      <Section title="App Lock" sub={user?.has_pin ? 'PIN is set — app locks on idle' : 'No PIN set — app opens without authentication'}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)]"
            style={{
              background: user?.has_pin ? 'var(--gdim)' : 'var(--ydim)',
              border: `1px solid ${user?.has_pin ? 'rgba(16,217,160,0.2)' : 'rgba(245,158,11,0.2)'}`,
            }}>
            {user?.has_pin
              ? <Lock size={13} className="text-[var(--green)]" />
              : <Unlock size={13} className="text-[var(--yellow)]" />}
            <span className="font-mono text-[12px]"
              style={{ color: user?.has_pin ? 'var(--green)' : 'var(--yellow)' }}>
              {user?.has_pin ? 'PIN lock enabled' : 'No PIN set — consider enabling for security'}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">
              {user?.has_pin ? 'Change PIN' : 'Set PIN'}
            </label>
            <input type="password" inputMode="numeric" maxLength={8}
              value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New PIN (4-8 digits)"
              className="px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px]"
              style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }} />
            <input type="password" inputMode="numeric" maxLength={8}
              value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm PIN"
              className="px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px]"
              style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }} />
            <button onClick={handleSetPin} disabled={savingPin}
              className="py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium"
              style={{ background: 'var(--accent)' }}>
              {savingPin ? 'Saving…' : user?.has_pin ? 'Update PIN' : 'Enable PIN Lock'}
            </button>
          </div>

          {user?.has_pin && (
            <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--b1)' }}>
              <label className="font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">Remove PIN</label>
              <div className="flex gap-2">
                <input type="password" inputMode="numeric"
                  value={currentPin} onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Current PIN"
                  className="flex-1 px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[13px]"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }} />
                <button onClick={handleRemovePin} disabled={savingPin}
                  className="px-4 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
                  style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
                  Remove
                </button>
              </div>
            </div>
          )}

          {pinMsg && (
            <span className="font-mono text-[11px]"
              style={{ color: pinMsg.includes('✓') ? 'var(--green)' : 'var(--red)' }}>
              {pinMsg}
            </span>
          )}
        </div>
      </Section>

      <Section title="System" sub="Local installation info">
        <div className="flex flex-col gap-2">
          {[
            ['Version', '0.1.0'],
            ['Database', 'SQLite · local'],
            ['Credentials', 'Windows Credential Manager'],
            ['MCP Runtime', 'Node.js (local)'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--b1)' }}>
              <span className="font-mono text-[12px] text-[var(--t3)]">{k}</span>
              <span className="font-mono text-[12px] text-[var(--t2)]">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Software Updates" sub="Check for new versions of SYNIO SEO Hub">
        <UpdateChecker />
      </Section>
    </div>
  )
}

// ── Credentials tab ───────────────────────────────────────────────────────

const MCP_META: Record<string, { color: string; icon: string; hint: string; placeholder: string }> = {
  gsc:        { color: '#4ade80', icon: '🔵', hint: 'Drop the service account JSON here — configures GSC and GA4 at the same time. Then add the service account email as a user in Search Console → Settings → Users.', placeholder: '/path/to/service-account.json' },
  bwt:        { color: '#38bdf8', icon: '🟢', hint: 'Bing Webmaster → Settings → API Access', placeholder: 'Enter Bing API key…' },
  ga4:        { color: '#fb923c', icon: '🟠', hint: 'Same JSON as GSC — drop it in either row and both get configured. Grant the service account Viewer access in GA4 Admin → Property Access Management.', placeholder: '/path/to/service-account.json' },
  clarity:    { color: '#a78bfa', icon: '🟣', hint: 'Global fallback token — used for sites without a site-specific token. Set per-site tokens in Sites → expand a site → Clarity Token. Each Clarity project has its own token.', placeholder: 'Enter global fallback Clarity token…' },
  psi:        { color: '#fbbf24', icon: '🟡', hint: 'Google Cloud Console → APIs & Services → Credentials → Create API key (enable PageSpeed Insights API first)', placeholder: 'Enter PSI API key…' },
  playwright:    { color: '#10d9a0', icon: '🟤', hint: 'No credentials needed — uses local browser', placeholder: 'No key required' },
  openpagerank:  { color: '#e879f9', icon: '🟤', hint: 'domcop.com/openpagerank → Sign up free → My API Keys → Create key. Gives domain PageRank and global rank (updates every ~3 months).', placeholder: 'Enter OpenPageRank API key…' },
}

function StatusIcon({ s }: { s: CredentialStatus }) {
  if (s.service === 'playwright') return <CheckCircle size={14} className="text-[var(--green)]" />
  if (s.is_configured && s.is_active && !s.last_error) return <CheckCircle size={14} className="text-[var(--green)]" />
  if (s.is_configured && s.last_error) return <AlertCircle size={14} className="text-[var(--yellow)]" />
  return <XCircle size={14} className="text-[var(--t3)]" />
}

function CredentialRow({ cred, onUpdate }: { cred: CredentialStatus; onUpdate: () => void }) {
  const meta = MCP_META[cred.service]
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [error, setError] = useState('')
  const [importedEmail, setImportedEmail] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isNoKey = cred.service === 'playwright'
  const isFile = cred.credential_type === 'service_account_path'
  const isConnected = cred.service === 'playwright' || (cred.is_configured && !cred.last_error)

  async function handleSave() {
    if (!value.trim() && !isNoKey) { setError('Enter a value'); return }
    setSaving(true); setError('')
    try {
      await saveCredential({ service: cred.service, secret: isNoKey ? '_NO_SECRET_' : value, file_path: isFile ? value : undefined })
      setValue('')
      onUpdate()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleFileImport(file: File) {
    setSaving(true); setError(''); setImportedEmail(null)
    try {
      const content = await file.text()
      const email = await importServiceAccount(cred.service, content)
      setImportedEmail(email)
      onUpdate()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileImport(file)
  }

  async function handleTest() {
    setTesting(true); setTestResult(null)
    try {
      const r = await testCredential(cred.service)
      setTestResult(r)
      onUpdate()
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-[var(--rl)] border overflow-hidden"
      style={{ background: 'var(--s1)', borderColor: isConnected ? meta.color + '33' : 'var(--b1)' }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'var(--b1)', background: 'var(--s2)' }}>
        <div className="w-8 h-8 rounded-[var(--r)] flex items-center justify-center text-base flex-shrink-0"
          style={{ background: meta.color + '18', border: `1px solid ${meta.color}33` }}>
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[14px] text-[var(--t1)]">{cred.label}</div>
          <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mt-0.5">{cred.service}</div>
        </div>
        <StatusIcon s={cred} />
        {cred.is_configured && (
          <span className="font-mono text-[10px] px-2 py-0.5 rounded"
            style={{ background: isConnected ? 'var(--gdim)' : 'var(--ydim)', color: isConnected ? 'var(--green)' : 'var(--yellow)' }}>
            {isConnected ? 'CONNECTED' : 'ERROR'}
          </span>
        )}
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-[var(--r)]"
          style={{ background: 'var(--s3)', border: '1px solid var(--b1)' }}>
          <span className="text-[11px] mt-px">💡</span>
          <span className="font-mono text-[11px] text-[var(--t3)]">{meta.hint}</span>
          <a href={cred.docs_url} target="_blank" rel="noreferrer"
            className="ml-auto flex-shrink-0 text-[var(--accent)] hover:text-[var(--accent2)]">
            <ExternalLink size={11} />
          </a>
        </div>

        {!isNoKey && isFile && (
          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept=".json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileImport(f) }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={saving}
              className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}>
              <Upload size={12} />
              {saving ? 'Importing…' : cred.is_configured ? 'Replace JSON file' : 'Select service-account.json'}
            </button>
            {importedEmail && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--green)' }}>✓ {importedEmail}</span>
            )}
            {cred.is_configured && !importedEmail && cred.file_path && (
              <span className="font-mono text-[10px] text-[var(--t3)] truncate max-w-[200px]" title={cred.file_path}>
                ✓ {cred.file_path.split('/').pop()}
              </span>
            )}
          </div>
        )}

        {!isNoKey && !isFile && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={show ? 'text' : 'password'} value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder={cred.is_configured ? '••••••••••••  (configured)' : meta.placeholder}
                className="w-full px-3 py-2 pr-8 rounded-[var(--r)] border outline-none font-mono text-[12px] transition-colors"
                style={{ background: 'var(--bg2)', borderColor: value ? 'var(--accent)' : 'var(--b2)', color: 'var(--t1)' }} />
              <button onClick={() => setShow(!show)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t2)]">
                {show ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <button onClick={handleSave} disabled={saving || !value.trim()}
              className="px-3 py-2 rounded-[var(--r)] font-mono text-[12px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {saving ? '…' : 'Save'}
            </button>
          </div>
        )}

        {error && <div className="font-mono text-[11px] text-[var(--red)]">{error}</div>}

        {testResult && (
          <div className="px-2.5 py-2 rounded-[var(--r)] font-mono text-[11px]"
            style={{
              background: testResult.success ? 'var(--gdim)' : 'var(--rdim)',
              border: `1px solid ${testResult.success ? 'rgba(16,217,160,0.2)' : 'rgba(244,63,94,0.2)'}`,
              color: testResult.success ? 'var(--green)' : 'var(--red)',
            }}>
            {testResult.message}
            {testResult.latency_ms && <span className="ml-2 text-[var(--t3)]">{testResult.latency_ms}ms</span>}
          </div>
        )}

        {cred.last_error && (
          <div className="font-mono text-[11px] text-[var(--red)] px-2.5 py-1.5 rounded-[var(--r)]"
            style={{ background: 'var(--rdim)' }}>
            ⚠ {cred.last_error}
          </div>
        )}

        {cred.is_configured && (
          <div className="flex gap-2 pt-1">
            <button onClick={handleTest} disabled={testing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
              style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
              <TestTube size={11} />
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {!isNoKey && (
              <button onClick={async () => { await deleteCredential(cred.service); onUpdate() }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
                style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
                <Trash2 size={11} /> Remove
              </button>
            )}
            {cred.last_tested && (
              <span className="ml-auto font-mono text-[10px] text-[var(--t3)] self-center">
                Tested {new Date(cred.last_tested).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CredentialsTab() {
  const { credentials, setCredentials } = useAppStore()
  const configurable = credentials.filter(c => c.service !== 'playwright')
  const total        = configurable.length
  const connected    = configurable.filter(c => c.is_configured).length

  async function load() {
    setCredentials(await getAllCredentialStatuses())
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Progress */}
      <div className="p-4 rounded-[var(--rl)] border"
        style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
        <div className="flex justify-between mb-2">
          <span className="font-mono text-[11px] text-[var(--t3)] uppercase tracking-wider">Setup Progress</span>
          <span className="font-mono text-[11px]" style={{ color: connected === total ? 'var(--green)' : 'var(--accent)' }}>
            {connected}/{total} {connected === total ? '— Fully configured ✓' : ''}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--b1)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${(connected / total) * 100}%`,
              background: connected === total ? 'var(--green)' : 'linear-gradient(90deg, var(--accent), var(--accent2))',
            }} />
        </div>
        <div className="flex mt-2 gap-1.5">
          {credentials.map(c => (
            <div key={c.service} className="flex-1 h-1 rounded-full"
              style={{ background: c.is_configured ? (c.last_error ? 'var(--yellow)' : 'var(--green)') : 'var(--b2)' }} />
          ))}
        </div>
      </div>

      {credentials.map((c, i) => (
        <div key={c.service} style={{ animationDelay: `${i * 0.05}s` }}>
          <CredentialRow cred={c} onUpdate={load} />
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

type Tab = 'general' | 'credentials'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general',     label: 'General' },
  { id: 'credentials', label: 'Credentials' },
]

export default function Settings({ initialTab }: { initialTab?: Tab }) {
  const { credentials } = useAppStore()
  const configurable = credentials.filter(c => c.service !== 'playwright')
  const total        = configurable.length
  const connected    = configurable.filter(c => c.is_configured).length
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general')

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-5">
          <h1 className="font-display text-2xl text-[var(--t1)]">
            App <span className="text-[var(--accent)]">Settings</span>
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 mb-6 rounded-[var(--r)] border"
          style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="relative flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-[var(--r)] font-mono text-[12px] font-medium transition-all"
              style={{
                background: tab === t.id ? 'var(--s1)' : 'transparent',
                color: tab === t.id ? 'var(--t1)' : 'var(--t3)',
                border: tab === t.id ? '1px solid var(--b2)' : '1px solid transparent',
              }}>
              {t.label}
              {t.id === 'credentials' && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: connected === total ? 'var(--gdim)' : 'var(--ydim)',
                    color: connected === total ? 'var(--green)' : 'var(--yellow)',
                  }}>
                  {connected}/{total}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'general'     && <GeneralTab />}
        {tab === 'credentials' && <CredentialsTab />}
      </div>
    </div>
  )
}
