import { useState, useMemo } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { getSiteSnapshots } from '../lib/tauri'
import { useEffect } from 'react'
import type { Snapshot } from '../lib/tauri'

interface Keyword {
  keyword: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  source: 'gsc' | 'bwt'
}

type KwTab = 'all' | 'quickwins' | 'oportunidades'

const TAB_CONFIG: { id: KwTab; label: string; description: string; color: string; dimColor: string }[] = [
  {
    id: 'all',
    label: 'All',
    description: 'All keywords from Google Search Console and Bing Webmaster Tools, sorted by impressions.',
    color: 'var(--accent)',
    dimColor: 'var(--adim)',
  },
  {
    id: 'quickwins',
    label: '⚡ Quick Wins',
    description: 'Positions 5–20 with >500 impressions. You\'re close to page 1 — a title/content tweak could jump you there.',
    color: 'var(--accent)',
    dimColor: 'var(--adim)',
  },
  {
    id: 'oportunidades',
    label: '🎯 Opportunities',
    description: 'Keywords with >20 impressions and 0 clicks. You appear in results but nobody clicks — your title or meta description needs work.',
    color: 'var(--red)',
    dimColor: 'var(--rdim)',
  },
]

function parseKeywords(snaps: Snapshot[]): Keyword[] {
  const result: Keyword[] = []
  const gscSnap = snaps.find(s => s.source === 'gsc')
  const bwtSnap = snaps.find(s => s.source === 'bwt')

  const gscRaw = Array.isArray(gscSnap?.data?.keywords) ? gscSnap!.data.keywords as any[] : []
  const bwtRaw = Array.isArray(bwtSnap?.data?.keywords) ? bwtSnap!.data.keywords as any[] : []
  const gscKeywords: Keyword[] = gscRaw.map((k: any) => ({ ...k, source: 'gsc' as const }))
  const gscSet = new Set(gscKeywords.map(k => k.keyword.toLowerCase()))
  const bwtKeywords: Keyword[] = bwtRaw
    .filter((k: any) => !gscSet.has(k.keyword.toLowerCase()))
    .map((k: any) => ({ ...k, source: 'bwt' as const }))

  return [...gscKeywords, ...bwtKeywords].sort((a, b) => b.impressions - a.impressions)
}

export default function KeywordsDetail() {
  const { sites, activeSiteId, setActiveNav } = useAppStore()
  const site = sites.find(s => s.id === activeSiteId)
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [tab, setTab] = useState<KwTab>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!activeSiteId) return
    getSiteSnapshots(activeSiteId).then(snaps => setKeywords(parseKeywords(snaps))).catch(() => {})
  }, [activeSiteId])

  const filtered = useMemo(() => {
    let list = keywords
    if (tab === 'quickwins') list = list.filter(k => k.position >= 5 && k.position <= 20 && k.impressions > 500)
    if (tab === 'oportunidades') list = list.filter(k => k.impressions > 20 && k.clicks === 0)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(k => k.keyword.toLowerCase().includes(q))
    }
    return list
  }, [keywords, tab, search])

  const activeTab = TAB_CONFIG.find(t => t.id === tab)!

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setActiveNav('dashboard')}
          className="flex items-center gap-1.5 font-mono text-[12px] px-3 py-1.5 rounded transition-colors"
          style={{ background: 'var(--s2)', color: 'var(--t3)', border: '1px solid var(--b1)' }}
        >
          <ArrowLeft size={11} /> Back
        </button>
        <div>
          <h1 className="font-medium text-[16px] text-[var(--t1)]">Keyword Performance</h1>
          {site && <div className="font-mono text-[12px] text-[var(--t3)] mt-0.5">{site.domain} · GSC + BWT · {keywords.length} keywords</div>}
        </div>
      </div>

      {/* Tab bar + description */}
      <div className="rounded-[var(--rl)] border mb-4 overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
          {TAB_CONFIG.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded font-mono text-[11px] uppercase tracking-wide transition-colors whitespace-nowrap"
              style={{
                background: tab === t.id ? t.dimColor : 'transparent',
                color: tab === t.id ? t.color : 'var(--t3)',
                border: tab === t.id ? `1px solid ${t.color}33` : '1px solid transparent',
              }}
            >
              {t.label}
              {t.id === 'quickwins' && keywords.filter(k => k.position >= 5 && k.position <= 20 && k.impressions > 500).length > 0 && (
                <span className="ml-1.5 px-1 py-0.5 rounded text-[8px]" style={{ background: t.dimColor }}>
                  {keywords.filter(k => k.position >= 5 && k.position <= 20 && k.impressions > 500).length}
                </span>
              )}
              {t.id === 'oportunidades' && keywords.filter(k => k.impressions > 20 && k.clicks === 0).length > 0 && (
                <span className="ml-1.5 px-1 py-0.5 rounded text-[8px]" style={{ background: 'var(--rdim)', color: 'var(--red)' }}>
                  {keywords.filter(k => k.impressions > 20 && k.clicks === 0).length}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          {/* Search */}
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--t3)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter keywords…"
              className="pl-7 pr-3 py-1.5 rounded font-mono text-[12px] outline-none w-48"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)', color: 'var(--t1)' }}
            />
          </div>
        </div>
        {/* Tab description */}
        <div className="px-4 py-2" style={{ background: 'var(--s2)' }}>
          <span className="font-mono text-[11px] text-[var(--t3)]">{activeTab.description}</span>
          <span className="font-mono text-[11px] ml-3" style={{ color: activeTab.color }}>
            {filtered.length} keyword{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center font-mono text-[12px] text-[var(--t3)]">
            {keywords.length === 0
              ? 'No keyword data — refresh GSC or BWT from the Dashboard.'
              : search
              ? `No keywords match "${search}"`
              : tab === 'quickwins'
              ? 'No quick wins found. You may need more impressions or keywords closer to positions 5–20.'
              : 'No opportunities found. Keywords with impressions and 0 clicks would appear here.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--s2)' }}>
                  {['#', 'Keyword', 'Source', 'Position', 'Clicks', 'Impressions', 'CTR', 'Opportunity'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((kw, i) => {
                  const opp = kw.position >= 5 && kw.position <= 12 ? 'HIGH' : kw.position <= 20 ? 'MED' : 'LOW'
                  const oppColor = opp === 'HIGH' ? 'var(--accent)' : opp === 'MED' ? 'var(--yellow)' : 'var(--t3)'
                  const posColor = kw.position <= 10 ? 'var(--green)' : kw.position <= 20 ? 'var(--yellow)' : 'var(--red)'
                  const posBg = kw.position <= 10 ? 'var(--gdim)' : kw.position <= 20 ? 'var(--ydim)' : 'var(--rdim)'
                  return (
                    <tr key={i} className="border-t hover:bg-[var(--s2)] transition-colors"
                      style={{ borderColor: 'rgba(28,43,56,0.6)' }}>
                      <td className="px-4 py-3 font-mono text-[11px] text-[var(--t3)]">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-[13px] text-[var(--t1)] max-w-xs truncate" title={kw.keyword}>{kw.keyword}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: kw.source === 'bwt' ? 'var(--gdim)' : 'var(--bdim)', color: kw.source === 'bwt' ? 'var(--green)' : 'var(--blue)' }}>
                          {kw.source === 'bwt' ? 'BWT' : 'GSC'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[12px] px-2 py-0.5 rounded font-bold" style={{ background: posBg, color: posColor }}>
                          #{kw.position}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[var(--t2)]">{kw.clicks.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[var(--t2)]">{kw.impressions.toLocaleString()}</td>
                      <td className="px-4 py-3 font-mono text-[13px]" style={{ color: kw.ctr < 3 ? 'var(--red)' : 'var(--t2)' }}>
                        {kw.ctr}%
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--b1)', maxWidth: 64 }}>
                            <div className="h-1.5 rounded-full"
                              style={{ width: `${opp === 'HIGH' ? 85 : opp === 'MED' ? 55 : 25}%`, background: oppColor }} />
                          </div>
                          <span className="font-mono text-[10px] font-bold w-8" style={{ color: oppColor }}>{opp}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
