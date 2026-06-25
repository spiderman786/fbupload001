/** Public profile URLs for page cards and detail headers. */

export function facebookPagePublicUrl(metaPageId: string): string {
  const id = metaPageId.trim()
  if (/^\d+$/.test(id)) {
    return `https://www.facebook.com/profile.php?id=${id}`
  }
  return `https://www.facebook.com/${id.replace(/^@/, '')}`
}

export function sourcePublicUrl(platform: string, username: string): string {
  const handle = username.replace(/^@/, '').trim()
  switch (platform.toLowerCase()) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/reels/`
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`
    case 'youtube':
      return handle.startsWith('@')
        ? `https://www.youtube.com/${handle}/shorts`
        : `https://www.youtube.com/@${handle}/shorts`
    case 'facebook':
      if (/^\d+$/.test(handle)) {
        return `https://www.facebook.com/profile.php?id=${handle}&sk=reels_tab`
      }
      return `https://www.facebook.com/${handle}/reels/`
    default:
      return `https://www.google.com/search?q=${encodeURIComponent(`@${handle}`)}`
  }
}
