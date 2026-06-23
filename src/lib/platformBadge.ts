import { Music2, Share2, TvMinimalPlay } from 'lucide-react'
import type { ElementType } from 'react'

export function queuePlatformBadgeLabel(platform: string | null | undefined): string {
  const p = (platform ?? '').toLowerCase()
  if (p === 'tiktok') return 'Tiktok'
  if (p === 'facebook') return 'fb'
  if (p === 'youtube') return 'yt shorts'
  if (p === 'instagram') return 'IG'
  return p || 'Source'
}

export function queuePlatformIcon(platform: string | null | undefined): ElementType {
  const p = (platform ?? '').toLowerCase()
  if (p === 'tiktok') return Music2
  if (p === 'youtube') return TvMinimalPlay
  return Share2
}
