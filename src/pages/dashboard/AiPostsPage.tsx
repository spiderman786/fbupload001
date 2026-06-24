import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { api, type FacebookPage } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function AiPostsPage() {
  const toast = useToast()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [pageId, setPageId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [postType, setPostType] = useState<'text' | 'image'>('text')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.pages
      .list()
      .then((res) => setPages(res.pages.filter((p) => p.status === 'active')))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pageId || !prompt.trim()) return
    setSubmitting(true)
    try {
      const res = await api.automation.aiPost({ pageId, prompt: prompt.trim(), postType })
      toast.success(res.message)
    } catch (err) {
      const message = getApiError(err, 'AI post failed')
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">AI Text/Image Posts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate and publish AI-assisted posts to Facebook pages. Requires an OpenAI API key on the server.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="marketing-card space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Facebook page</label>
            <select
              required
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Select page…</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Post type</label>
            <select value={postType} onChange={(e) => setPostType(e.target.value as 'text' | 'image')} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm">
              <option value="text">Text post</option>
              <option value="image">Image post</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Prompt</label>
            <textarea
              required
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe the post you want the AI to create…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" disabled={submitting || !pages.length} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {submitting ? 'Generating…' : 'Generate & publish'}
          </button>
          {!pages.length ? (
            <p className="text-xs text-muted-foreground">
              <Link to="/facebook/accounts" className="text-primary hover:underline">Connect a page</Link> first.
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}
