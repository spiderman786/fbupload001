export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  if (process.env.SMTP_HOST) {
    // Production: wire up nodemailer when SMTP env vars are set
    console.log(`[email] Would send verification to ${email} (SMTP configured)`)
    return
  }

  console.log('\n========================================')
  console.log(`  VERIFICATION CODE for ${email}`)
  console.log(`  Code: ${code}`)
  console.log('========================================\n')
}
