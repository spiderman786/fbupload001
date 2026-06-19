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
}

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function getSmtpConfig(): SmtpConfig | null {
  const provider = process.env.SMTP_PROVIDER?.trim().toLowerCase()
  const providerDefaults = provider ? SMTP_PROVIDER_DEFAULTS[provider] : undefined
  const host = process.env.SMTP_HOST?.trim() || providerDefaults?.host
  if (!host) return null

  const port = Number(process.env.SMTP_PORT ?? providerDefaults?.port ?? 587)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM?.trim() || user
  const secure = asBool(process.env.SMTP_SECURE, providerDefaults?.secure ?? port === 465)

  if (provider && !providerDefaults) {
    throw new Error(`Unsupported SMTP_PROVIDER "${provider}". Use "gmail" or "outlook".`)
  }

  if (!user || !pass || !from) {
    throw new Error('SMTP is partially configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM (or SMTP_USER).')
  }

  return { host, port, user, pass, from, secure }
}

type SocketLike = net.Socket | tls.TLSSocket

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
      socket.once('error', reject)
    })
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port }, () => resolve(socket))
    socket.once('error', reject)
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

  async function command(cmd: string, expectedFirstDigit: '2' | '3' = '2'): Promise<string> {
    socket.write(`${cmd}\r\n`)
    const reply = await waitForReply()
    if (!reply.startsWith(expectedFirstDigit)) {
      throw new Error(`SMTP command failed (${cmd}): ${reply}`)
    }
    return reply
  }

  return { command, waitForReply }
}

async function sendViaSmtp(config: SmtpConfig, to: string, subject: string, body: string): Promise<void> {
  const socket = await createSocket(config)
  const session = createSmtpSession(socket)

  try {
    const greeting = await session.waitForReply()
    if (!greeting.startsWith('2')) {
      throw new Error(`SMTP greeting failed: ${greeting}`)
    }

    await session.command('EHLO fbuploadplus.app')
    await session.command('AUTH LOGIN', '3')
    await session.command(Buffer.from(config.user).toString('base64'), '3')
    await session.command(Buffer.from(config.pass).toString('base64'), '2')
    await session.command(`MAIL FROM:<${config.from}>`)
    await session.command(`RCPT TO:<${to}>`)
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

    socket.write(message)
    const dataReply = await session.waitForReply()
    if (!dataReply.startsWith('2')) {
      throw new Error(`SMTP DATA failed: ${dataReply}`)
    }

    await session.command('QUIT')
  } finally {
    socket.destroy()
  }
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
