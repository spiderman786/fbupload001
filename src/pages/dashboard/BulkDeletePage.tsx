import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api, type FacebookPage } from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { getApiError } from '../../lib/apiError'

export function BulkDeletePage() {
  const toast = useToast()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [pageId, setPageId] = useState('')
  const [posts, setPosts] = useState<{ id: string; message?: string; created_time: string }[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    api.pages.list().then((p) => {
      setPages(p.pages)
      setLoading(false)
    })
  }, [])

  async function loadPosts(id: string) {
    setPageId(id)
    setLoadingPosts(true)
    setSelected(new Set())
    try {
      const { posts: list, mockMode } = await api.automation.listPosts(id)
      setPosts(list)
      if (mockMode) toast.info('Mock mode — no real posts loaded')
    } catch (err) {
      toast.error(getApiError(err, 'Failed to load posts'))
      setPosts([])
    } finally {
      setLoadingPosts(false)
    }
  }

  async function handleDeleteSelected() {
    if (!pageId || selected.size === 0) return
    if (!confirm(`Delete ${selected.size} post(s)?`)) return
    setDeleting(true)
    try {
      const res = await api.automation.bulkDelete({ pageId, postIds: [...selected] })
      toast.success(`Deleted ${res.deleted.length} post(s)`)
      setPosts((prev) => prev.filter((p) => !res.deleted.includes(p.id)))
      setSelected(new Set())
    } catch (err) {
      toast.error(getApiError(err, 'Bulk delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteAll() {
    if (!pageId) return
    if (!confirm('Delete ALL recent posts from this page?')) return
    setDeleting(true)
    try {
      const res = await api.automation.bulkDelete({ pageId, deleteAll: true })
      toast.success(`Deleted ${res.deleted.length} post(s)`)
      setPosts([])
      setSelected(new Set())
    } catch (err) {
      toast.error(getApiError(err, 'Bulk delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-red-100 bg-red-50 p-2">
          <Trash2 className="h-5 w-5 text-red-600" />
        </div>
        <h1 className="font-display text-2xl font-bold">Bulk Delete Posts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Remove posts from connected Facebook pages via Graph API.
        </p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Select page</label>
            <select
              value={pageId}
              onChange={(e) => loadPosts(e.target.value)}
              className="h-10 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Choose a page...</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {pageId && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting || selected.size === 0}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Delete selected ({selected.size})
                </button>
                <button
                  onClick={handleDeleteAll}
                  disabled={deleting}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete all recent
                </button>
              </div>

              {loadingPosts ? (
                <div className="flex h-24 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : posts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No posts found on this page.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border bg-card">
                  {posts.map((post) => (
                    <label key={post.id} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={selected.has(post.id)}
                        onChange={() => toggle(post.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{post.message || '(no text)'}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(post.created_time).toLocaleString()} · {post.id}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
