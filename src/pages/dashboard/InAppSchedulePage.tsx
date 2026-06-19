import { SchedulePage } from './SchedulePage'

export function InAppSchedulePage() {
  return (
    <SchedulePage
      publishMode="inapp"
      title="InApp Schedule"
      description="Queue reels at USA peak engagement times. Jobs run through the internal worker queue."
    />
  )
}

export function DirectSchedulePage() {
  return (
    <SchedulePage
      publishMode="direct"
      title="Direct Schedule"
      description="Schedule automated reel publishing at USA peak engagement times (US Eastern)."
    />
  )
}
