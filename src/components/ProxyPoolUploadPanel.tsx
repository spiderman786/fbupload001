import { useRef, useState, type ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../context/ToastContext'
import { getApiError } from '../lib/apiError'

type Props = {
  compact?: boolean
  onUploaded?: () => void
}

export function ProxyPoolUploadPanel({ compact, onUploaded }: Props) {
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUploadContent(content: string) {
    if (!content.trim()) {
      toast.error('Proxy list is empty')
      return
    }

    setUploading(true)
    try {
      const result = await api.proxyPool.upload(content)
      setPasteText('')
      toast.success(`Loaded ${result.count} proxies`)
      onUploaded?.()
    } catch (err) {
      toast.error(getApiError(err, 'Failed to upload proxies'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await handleUploadContent(await file.text())
    } catch {
      toast.error('Could not read file')
    }
  }

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload proxy file'}
        </button>
        <input ref={fileInputRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={handleFileChange} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
      >
        <Upload className="h-4 w-4" />
        {uploading ? 'Uploading…' : 'Choose proxy file (.txt / .csv)'}
      </button>
      <input ref={fileInputRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={handleFileChange} />

      <div className="space-y-2">
        <label htmlFor="proxy-paste-inline" className="text-sm font-medium">
          Or paste proxies (one per line)
        </label>
        <textarea
          id="proxy-paste-inline"
          rows={5}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={`http://user:pass@1.2.3.4:8080\n1.2.3.4:8080:user:pass`}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          disabled={uploading || !pasteText.trim()}
          onClick={() => handleUploadContent(pasteText)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Save pasted list
        </button>
      </div>
    </div>
  )
}
