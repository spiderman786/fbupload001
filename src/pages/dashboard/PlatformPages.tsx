import { useLocation } from 'react-router-dom'
import { PlatformByocPage } from './PlatformByocPage'
import { PlatformToolsPage } from './PlatformToolsPage'

export function YoutubeToolsPage() {
  const { pathname } = useLocation()
  return <PlatformToolsPage platform="youtube" pathname={pathname} />
}

export function InstagramToolsPage() {
  const { pathname } = useLocation()
  return <PlatformToolsPage platform="instagram" pathname={pathname} />
}

export function YoutubeByocPage() {
  return <PlatformByocPage platform="youtube" />
}

export function InstagramByocPage() {
  return <PlatformByocPage platform="instagram" />
}
