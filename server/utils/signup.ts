/** Public self-signup creates a new agency with role "owner". On by default; set PUBLIC_SIGNUP_ENABLED=false to close. */
export function isPublicSignupEnabled(): boolean {
  const flag = process.env.PUBLIC_SIGNUP_ENABLED?.trim().toLowerCase()
  if (flag === 'false' || flag === '0' || flag === 'no') return false
  return true
}
