import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  CalendarClock,
  CreditCard,
  Download,
  Globe,
  LayoutDashboard,
  Link2,
  ListChecks,
  Send,
  Settings,
  Share2,
  Trash2,
  Upload,
  Users,
  Video,
} from 'lucide-react'

export type NavItem = { to: string; label: string; icon?: LucideIcon }
export type NavSection = { title?: string; items: NavItem[]; collapsible?: boolean; platform?: string }

export const DASHBOARD_NAV: NavSection[] = [
  {
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'PLATFORM',
    collapsible: true,
    platform: 'facebook',
    items: [
      { to: '/facebook/accounts', label: 'Accounts', icon: Link2 },
      { to: '/facebook/auto-download-upload', label: 'Auto Download/Upload', icon: Download },
      { to: '/facebook/jobs', label: 'Reel Jobs', icon: ListChecks },
      { to: '/facebook/bulk-delete', label: 'Bulk Delete Posts', icon: Trash2 },
      { to: '/facebook/direct-post', label: 'Direct Post', icon: Send },
      { to: '/facebook/direct-schedule', label: 'Direct Schedule', icon: CalendarClock },
      { to: '/facebook/inapp-schedule', label: 'InApp Schedule', icon: CalendarClock },
      { to: '/facebook/ai-posts', label: 'AI Text/Image Posts', icon: Bot },
      { to: '/facebook/payout', label: 'Payout Transfer', icon: CreditCard },
    ],
  },
  {
    collapsible: true,
    platform: 'youtube',
    items: [
      { to: '/youtube/accounts', label: 'Accounts', icon: Link2 },
      { to: '/youtube/direct-post', label: 'Direct Post', icon: Send },
      { to: '/youtube/direct-schedule', label: 'Direct Schedule', icon: CalendarClock },
      { to: '/youtube/inapp-schedule', label: 'InApp Schedule', icon: CalendarClock },
    ],
  },
  {
    collapsible: true,
    platform: 'instagram',
    items: [
      { to: '/instagram/accounts', label: 'Accounts', icon: Link2 },
      { to: '/instagram/direct-post', label: 'Direct Post', icon: Send },
      { to: '/instagram/direct-schedule', label: 'Direct Schedule', icon: CalendarClock },
      { to: '/instagram/inapp-schedule', label: 'InApp Schedule', icon: CalendarClock },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      { to: '/settings/team', label: 'Team', icon: Users },
      { to: '/settings/facebook-byoc', label: 'Facebook BYOC', icon: Settings },
      { to: '/settings/youtube-byoc', label: 'YouTube BYOC', icon: Settings },
      { to: '/settings/instagram-byoc', label: 'Instagram BYOC', icon: Settings },
    ],
  },
]

export const PLATFORM_ICONS: Record<string, LucideIcon> = {
  facebook: Share2,
  youtube: Video,
  instagram: Globe,
}

export const QUICK_LINKS = [
  { to: '/facebook/accounts', label: 'FB Accounts', desc: 'Connect accounts', icon: Link2 },
  { to: '/facebook/auto-download-upload', label: 'Auto Download/Upload', desc: 'Reel automation', icon: Upload },
  { to: '/facebook/direct-schedule', label: 'Direct Schedule', desc: 'Schedule posts', icon: CalendarClock },
  { to: '/facebook/direct-post', label: 'Direct Post', desc: 'Publish now', icon: Send },
  { to: '/facebook/inapp-schedule', label: 'InApp Schedule', desc: 'In-app queue', icon: CalendarClock },
  { to: '/facebook/bulk-delete', label: 'Bulk Delete', desc: 'Remove posts', icon: Trash2 },
  { to: '/settings/facebook-byoc', label: 'FB BYOC Settings', desc: 'App credentials', icon: Settings },
]

export const FEATURE_META: Record<string, { title: string; description: string }> = {
  '/facebook/bulk-delete': { title: 'Bulk Delete Posts', description: 'Delete multiple posts from connected Facebook pages in bulk.' },
  '/facebook/direct-post': { title: 'Direct Post', description: 'Publish reels directly to Facebook pages via Graph API.' },
  '/facebook/inapp-schedule': { title: 'InApp Schedule', description: 'Queue reels for in-app publishing at scheduled times.' },
  '/facebook/ai-posts': { title: 'AI Text/Image Posts', description: 'Generate and publish AI-assisted text and image posts.' },
  '/facebook/payout': { title: 'Payout Transfer', description: 'Manage payout transfers for monetized pages.' },
  '/youtube/accounts': { title: 'YouTube Accounts', description: 'Connect and manage YouTube channels for cross-posting.' },
  '/youtube/direct-post': { title: 'YouTube Direct Post', description: 'Publish content directly to YouTube.' },
  '/youtube/direct-schedule': { title: 'YouTube Direct Schedule', description: 'Schedule YouTube uploads via API.' },
  '/youtube/inapp-schedule': { title: 'YouTube InApp Schedule', description: 'Queue YouTube content for in-app publishing.' },
  '/instagram/accounts': { title: 'Instagram Accounts', description: 'Connect Instagram accounts as reel sources.' },
  '/instagram/direct-post': { title: 'Instagram Direct Post', description: 'Publish directly to Instagram.' },
  '/instagram/direct-schedule': { title: 'Instagram Direct Schedule', description: 'Schedule Instagram posts.' },
  '/instagram/inapp-schedule': { title: 'Instagram InApp Schedule', description: 'Queue Instagram content for publishing.' },
  '/settings/facebook-byoc': { title: 'Facebook BYOC', description: 'Configure your own Facebook app credentials (Bring Your Own Connection).' },
  '/settings/youtube-byoc': { title: 'YouTube BYOC', description: 'Configure YouTube API credentials.' },
  '/settings/instagram-byoc': { title: 'Instagram BYOC', description: 'Configure Instagram API credentials.' },
}
