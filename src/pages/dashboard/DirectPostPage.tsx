import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Send } from 'lucide-react'
import { api, type FacebookPage, type SourceAccount } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function DirectPostPage() {
  const toast = useToast()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [sources, setSources] = useState<SourceAccount[]>([])
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [pageId, setPageId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    Promise.all([api.pages.list(), api.sources.list(), api.automation.assignments()])
      .then(([p, s, a]) => {
        setPages(p.pages.filter((pg) => pg.healthStatus === 'completed' && pg.status === 'active'))
        setSources(s.sources.filter((x) => x.isActive))
        const map: Record<string, string> = {}
        for (const asn of a.assignments) map[asn.pageId] = asn.sourceId
        setAssignments(map)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (pageId && assignments[pageId] && !sourceId) setSourceId(assignments[pageId]!)
  }, [pageId, assignments, sourceId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pageId) return
    setPosting(true)
    try {
      const res = await api.automation.directPost(pageId, sourceId || undefined)
      toast.success(res.message)
    } catch (err) {
      toast.error(getApiError(err, 'Direct post failed'))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Send className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">Direct Post</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download reel from source → strip metadata → publish to Facebook page via Graph API immediately.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active pages. <Link to="/facebook/accounts" className="text-primary hover:underline">Connect pages</Link> first.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="marketing-card space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Target Facebook page</label>
            <select
              required
              value={pageId}
              onChange={(e) => { setPageId(e.target.value); setSourceId(assignments[e.target.value] ?? '') }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Select page...</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Source account (IG / TikTok / YT / FB)</label>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Use page assignment...</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.username} ({s.platform})</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Pipeline: download → ffmpeg metadata strip → Facebook Reels upload. Requires{' '}
            <Link to="/settings/facebook-byoc" className="text-primary hover:underline">BYOC</Link> + yt-dlp/ffmpeg on server.
          </p>
          <button
            type="submit"
            disabled={posting || !pageId}
            className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {posting ? 'Publishing...' : 'Publish now'}
          </button>
        </form>
      )}
    </div>
  )
}
