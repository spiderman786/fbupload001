/** Public self-signup creates a new agency with role "owner". Off by default in production. */
export function isPublicSignupEnabled(): boolean {
  const flag = process.env.PUBLIC_SIGNUP_ENABLED?.trim().toLowerCase()
  if (flag === 'true' || flag === '1' || flag === 'yes') return true
  if (flag === 'false' || flag === '0' || flag === 'no') return false
  return process.env.NODE_ENV !== 'production'
}
