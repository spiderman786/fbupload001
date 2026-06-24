import { Link } from 'react-router-dom'
import { Download, Send } from 'lucide-react'

type Platform = 'youtube' | 'instagram'

const META: Record<
  Platform,
  Record<string, { title: string; description: string; icon: 'send' | 'download' }>
> = {
  youtube: {
    '/youtube/accounts': {
      title: 'YouTube Accounts',
      description: 'Connect YouTube channels for direct publishing. Channel OAuth upload is coming soon — use creators as download sources today.',
      icon: 'download',
    },
    '/youtube/direct-post': {
      title: 'YouTube Direct Post',
      description: 'Publish Shorts directly to YouTube via the Data API. Upload pipeline is in development.',
      icon: 'send',
    },
    '/youtube/direct-schedule': {
      title: 'YouTube Direct Schedule',
      description: 'Schedule Shorts uploads via the YouTube Data API.',
      icon: 'send',
    },
    '/youtube/inapp-schedule': {
      title: 'YouTube InApp Schedule',
      description: 'Queue Shorts for in-app publishing at scheduled times.',
      icon: 'send',
    },
  },
  instagram: {
    '/instagram/accounts': {
      title: 'Instagram Accounts',
      description: 'Connect Instagram Business accounts for direct publishing. OAuth publish flow is coming soon.',
      icon: 'download',
    },
    '/instagram/direct-post': {
      title: 'Instagram Direct Post',
      description: 'Publish Reels directly to Instagram via the Graph API.',
      icon: 'send',
    },
    '/instagram/direct-schedule': {
      title: 'Instagram Direct Schedule',
      description: 'Schedule Instagram Reels via the Graph API.',
      icon: 'send',
    },
    '/instagram/inapp-schedule': {
      title: 'Instagram InApp Schedule',
      description: 'Queue Instagram Reels for in-app publishing.',
      icon: 'send',
    },
  },
}

export function PlatformToolsPage({ platform, pathname }: { platform: Platform; pathname: string }) {
  const meta =
    META[platform][pathname] ??
    ({
      title: platform === 'youtube' ? 'YouTube' : 'Instagram',
      description: 'This tool is available in the agency portal.',
      icon: 'send' as const,
    })

  const Icon = meta.icon === 'download' ? Download : Send
  const platformLabel = platform === 'youtube' ? 'YouTube' : 'Instagram'

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-primary/15 bg-primary/5 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-bold">{meta.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 text-sm">
        <p className="font-medium">Available now</p>
        <p className="mt-2 text-muted-foreground">
          {platformLabel} creators work as <strong>download sources</strong> in Auto Download/Upload — reels are scraped and republished to Facebook pages.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/facebook/auto-download-upload" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            Auto Download/Upload
          </Link>
          <Link to={`/settings/${platform}-byoc`} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
            {platformLabel} BYOC settings
          </Link>
        </div>
      </div>
    </div>
  )
}
