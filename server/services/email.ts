import net from 'node:net'
import tls from 'node:tls'

type SmtpConfig = {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure: boolean
}

type ProviderDefaults = { host: string; port: number; secure: boolean }

const SMTP_PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  privateemail: { host: 'mail.privateemail.com', port: 465, secure: true },
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

const SMTP_PLACEHOLDER_PASSWORDS = new Set([
  'your-app-password',
  'your-password',
  'your-password-or-app-password',
  'your-16-char-app-password',
  'changeme',
  'password',
])

function getSmtpConfig(): SmtpConfig | null {
  const provider = process.env.SMTP_PROVIDER?.trim().toLowerCase()
  const providerDefaults = provider ? SMTP_PROVIDER_DEFAULTS[provider] : undefined
  const host = process.env.SMTP_HOST?.trim() || providerDefaults?.host
  if (!host) return null

  const port = Number(process.env.SMTP_PORT ?? providerDefaults?.port ?? 587)
  const user = process.env.SMTP_USER?.trim() || process.env.SMTP_FROM?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  const from = process.env.SMTP_FROM?.trim() || user
  const secure = asBool(process.env.SMTP_SECURE, providerDefaults?.secure ?? port === 465)

  if (provider && !providerDefaults) {
    throw new Error(`Unsupported SMTP_PROVIDER "${provider}". Use "gmail", "outlook", or "privateemail".`)
  }

  if (!user || !pass || !from) {
    throw new Error('SMTP is partially configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM (or SMTP_USER).')
  }

  if (SMTP_PLACEHOLDER_PASSWORDS.has(pass.toLowerCase())) {
    throw new Error(
      'SMTP_PASS is still a placeholder value. Set the real mailbox password in Railway Variables.',
    )
  }

  return { host, port, user, pass, from, secure }
}

export type SmtpConfigStatus = {
  configured: boolean
  host: string | null
  port: number | null
  secure: boolean | null
  user: string | null
  from: string | null
  issues: string[]
}

export function getSmtpConfigStatus(): SmtpConfigStatus {
  const issues: string[] = []
  try {
    const config = getSmtpConfig()
    if (!config) {
      return { configured: false, host: null, port: null, secure: null, user: null, from: null, issues: ['SMTP not configured'] }
    }
    if (!process.env.SMTP_USER?.trim() && process.env.SMTP_FROM?.trim()) {
      issues.push('SMTP_USER is missing — using SMTP_FROM for login (set both to the same mailbox email)')
    }
    if (config.from.toLowerCase() !== config.user.toLowerCase()) {
      issues.push('SMTP_FROM should match SMTP_USER for Private Email')
    }
    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      issues,
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
    return {
      configured: false,
      host: process.env.SMTP_HOST?.trim() ?? null,
      port: Number(process.env.SMTP_PORT ?? 0) || null,
      secure: asBool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER?.trim() ?? process.env.SMTP_FROM?.trim() ?? null,
      from: process.env.SMTP_FROM?.trim() ?? null,
      issues,
    }
  }
}

/** Test SMTP login only (no email sent). For ops diagnostics. */
export async function testSmtpConnection(): Promise<{ ok: true } | { ok: false; stage: string; error: string }> {
  let config: SmtpConfig
  try {
    const loaded = getSmtpConfig()
    if (!loaded) return { ok: false, stage: 'config', error: 'SMTP not configured' }
    config = loaded
  } catch (error) {
    return { ok: false, stage: 'config', error: errorText(error) }
  }

  let socket = await createSocket(config)
  let session = createSmtpSession(socket)
  let stage = 'connect'

  try {
    stage = 'greeting'
    const greeting = await session.waitForReply()
    if (!greeting.startsWith('2')) throw new Error(`SMTP greeting failed: ${greeting}`)

    stage = 'ehlo'
    await session.command('EHLO fbuploadplus.app')
    if (!config.secure) {
      stage = 'starttls'
      await session.command('STARTTLS')
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: config.host, rejectUnauthorized: true }, () => resolve(upgraded))
        upgraded.once('error', (error) => reject(new Error(`SMTP TLS upgrade failed: ${errorText(error)}`)))
      })
      session = createSmtpSession(socket)
      stage = 'ehlo-after-starttls'
      await session.command('EHLO fbuploadplus.app')
    }
    stage = 'auth-login'
    await session.command('AUTH LOGIN', '3')
    stage = 'auth-user'
    await session.command(Buffer.from(config.user).toString('base64'), '3', 'AUTH USER')
    stage = 'auth-pass'
    await session.command(Buffer.from(config.pass).toString('base64'), '2', 'AUTH PASS')
    stage = 'quit'
    await session.command('QUIT')
    return { ok: true }
  } catch (error) {
    return { ok: false, stage, error: errorText(error) }
  } finally {
    socket.destroy()
  }
}

type SocketLike = net.Socket | tls.TLSSocket

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'Unknown SMTP error'
}

async function createSocket(config: SmtpConfig): Promise<SocketLike> {
  if (config.secure) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: config.host,
          port: config.port,
          servername: config.host,
          rejectUnauthorized: true,
        },
        () => resolve(socket),
      )
      socket.once('error', (error) => {
        reject(
          new Error(
            `SMTP TLS connection failed (${config.host}:${config.port}): ${errorText(error)}`,
          ),
        )
      })
    })
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port }, () => resolve(socket))
    socket.once('error', (error) => {
      reject(
        new Error(
          `SMTP TCP connection failed (${config.host}:${config.port}): ${errorText(error)}`,
        ),
      )
    })
  })
}

function createSmtpSession(socket: SocketLike) {
  let buffer = ''
  const pending: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = []

  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    while (true) {
      const lineEnd = buffer.indexOf('\r\n')
      if (lineEnd === -1) break

      const line = buffer.slice(0, lineEnd)
      buffer = buffer.slice(lineEnd + 2)

      const active = pending[0]
      if (!active) continue

      if (/^\d{3} /.test(line)) {
        pending.shift()
        active.resolve(line)
      }
    }
  })

  socket.on('error', (err) => {
    while (pending.length) {
      const active = pending.shift()
      active?.reject(err instanceof Error ? err : new Error(String(err)))
    }
  })

  function waitForReply(): Promise<string> {
    return new Promise((resolve, reject) => pending.push({ resolve, reject }))
  }

  async function command(
    cmd: string,
    expectedFirstDigit: '2' | '3' = '2',
    label = cmd,
  ): Promise<string> {
    socket.write(`${cmd}\r\n`)
    const reply = await waitForReply()
    if (!reply.startsWith(expectedFirstDigit)) {
      throw new Error(`SMTP command failed (${label}): ${reply}`)
    }
    return reply
  }

  return { command, waitForReply }
}

async function sendViaSmtp(config: SmtpConfig, to: string, subject: string, body: string): Promise<void> {
  let socket = await createSocket(config)
  let session = createSmtpSession(socket)
  let stage = 'connect'

  try {
    stage = 'greeting'
    const greeting = await session.waitForReply()
    if (!greeting.startsWith('2')) {
      throw new Error(`SMTP greeting failed: ${greeting}`)
    }

    stage = 'ehlo'
    await session.command('EHLO fbuploadplus.app')
    if (!config.secure) {
      // Port 587 commonly requires STARTTLS before AUTH LOGIN.
      stage = 'starttls'
      await session.command('STARTTLS')
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const upgraded = tls.connect(
          {
            socket,
            servername: config.host,
            rejectUnauthorized: true,
          },
          () => resolve(upgraded),
        )
        upgraded.once('error', (error) =>
          reject(new Error(`SMTP TLS upgrade failed: ${errorText(error)}`)),
        )
      })
      session = createSmtpSession(socket)
      stage = 'ehlo-after-starttls'
      await session.command('EHLO fbuploadplus.app')
    }
    stage = 'auth-login'
    await session.command('AUTH LOGIN', '3')
    stage = 'auth-user'
    await session.command(Buffer.from(config.user).toString('base64'), '3', 'AUTH USER')
    stage = 'auth-pass'
    await session.command(Buffer.from(config.pass).toString('base64'), '2', 'AUTH PASS')
    stage = 'mail-from'
    await session.command(`MAIL FROM:<${config.from}>`)
    stage = 'rcpt-to'
    await session.command(`RCPT TO:<${to}>`)
    stage = 'data'
    await session.command('DATA', '3')

    const escapedBody = body.replace(/\r?\n\./g, '\n..')
    const message = [
      `From: FBupload Plus <${config.from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      escapedBody,
      '.',
      '',
    ].join('\r\n')

    stage = 'data-body'
    socket.write(message)
    const dataReply = await session.waitForReply()
    if (!dataReply.startsWith('2')) {
      throw new Error(`SMTP DATA failed: ${dataReply}`)
    }

    stage = 'quit'
    await session.command('QUIT')
  } catch (error) {
    const details = errorText(error)
    console.error(`[email] SMTP send failed at "${stage}" (${config.host}:${config.port}): ${details}`)
    throw new Error(`SMTP send failed at "${stage}": ${details}`, { cause: error })
  } finally {
    socket.destroy()
  }
}

/** Safe message for API responses — never expose SMTP credentials or internal host details. */
export function userFacingEmailError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : String(error).trim()
  if (!raw) {
    return 'We could not send the email right now. Please try again in a few minutes.'
  }
  if (/not configured|partially configured|unsupported smtp_provider/i.test(raw)) {
    return 'Email delivery is not configured on the server. Please contact support.'
  }
  if (/auth-pass|auth-user|authentication failed|\b535\b/i.test(raw)) {
    return 'We could not send the verification email right now (mail server login failed). Check SMTP_USER and SMTP_PASS in Railway.'
  }
  if (/mail-from|sender|550|553/i.test(raw)) {
    return 'Mail server rejected the sender address. Set SMTP_FROM to the same email as SMTP_USER.'
  }
  if (/rcpt-to|recipient|554/i.test(raw)) {
    return 'Mail server rejected the recipient. Check that the Gmail address is valid.'
  }
  if (/placeholder value/i.test(raw)) {
    return 'SMTP password is still a placeholder. Set the real Private Email password in Railway Variables.'
  }
  if (process.env.NODE_ENV === 'production') {
    return 'We could not send the email right now. Please try again in a few minutes or contact support.'
  }
  return raw
}

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  const smtp = getSmtpConfig()
  if (!smtp) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Email delivery is not configured. Set SMTP_PROVIDER (gmail/outlook) or SMTP_HOST, plus SMTP_USER/SMTP_PASS.',
      )
    }
    console.log('\n========================================')
    console.log(`  VERIFICATION CODE for ${email}`)
    console.log(`  Code: ${code}`)
    console.log('========================================\n')
    return
  }

  const subject = 'Your FBupload Plus verification code'
  const body = `Your verification code is: ${code}\n\nThis code will expire in 15 minutes.`
  await sendViaSmtp(smtp, email, subject, body)
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  const smtp = getSmtpConfig()
  const resetUrl = `${(process.env.CLIENT_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/reset-password`
  if (!smtp) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Email delivery is not configured. Set SMTP_PROVIDER (gmail/outlook) or SMTP_HOST, plus SMTP_USER/SMTP_PASS.',
      )
    }
    console.log('\n========================================')
    console.log(`  PASSWORD RESET for ${email}`)
    console.log(`  Code: ${code}`)
    console.log(`  Reset page: ${resetUrl}`)
    console.log('========================================\n')
    return
  }

  const subject = 'Reset your FBupload Plus password'
  const body = `Your password reset code is: ${code}\n\nEnter this code at ${resetUrl}\n\nThis code expires in 1 hour.\n\nIf you did not request this, you can ignore this email.`
  await sendViaSmtp(smtp, email, subject, body)
}

export async function sendOpsAlertEmail(recipients: string[], alertType: string, message: string): Promise<void> {
  const smtp = getSmtpConfig()
  const subject = `[FBupload Plus Ops] ${alertType}`
  const body = `${message}\n\nTime: ${new Date().toISOString()}\n`
  if (!smtp) {
    console.log(`\n[OPS ALERT] ${subject}\n${body}`)
    return
  }
  for (const to of recipients) {
    await sendViaSmtp(smtp, to, subject, body)
  }
}
