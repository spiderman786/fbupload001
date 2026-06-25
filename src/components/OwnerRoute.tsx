import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAgencyRole } from '../context/AuthContext'

export function OwnerRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useAgencyRole()
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
