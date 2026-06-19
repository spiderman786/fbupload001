import { useLocation } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { FEATURE_META } from '../../config/dashboardNav'
import { FeaturePage } from './FeaturePage'

export function RoutedFeaturePage() {
  const { pathname } = useLocation()
  const meta = FEATURE_META[pathname] ?? { title: 'Feature', description: 'This feature is available in the agency portal.' }
  return <FeaturePage title={meta.title} description={meta.description} icon={Settings} />
}
