import { Link } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { Footer } from '../components/Footer'

export function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="container mx-auto max-w-3xl flex-1 px-4 py-24">
        <h1 className="font-display mb-8 text-3xl font-bold">Privacy Policy</h1>
        <div className="prose prose-sm max-w-none space-y-4 text-muted-foreground">
          <p>FBupload Plus respects your privacy. This policy describes how we handle your data.</p>
          <h2 className="text-lg font-semibold text-foreground">Bring Your Own Connection</h2>
          <p>We use official Meta OAuth to connect your Facebook accounts. We do not store your Facebook password. Access tokens are encrypted and used solely for publishing on your behalf.</p>
          <h2 className="text-lg font-semibold text-foreground">Data We Collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account information: name, Gmail address, WhatsApp number</li>
            <li>Connected page and source account metadata</li>
            <li>Automation logs and token transaction history</li>
          </ul>
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>For privacy inquiries: <a href="mailto:support@fbuploadplus.com" className="text-primary hover:underline">support@fbuploadplus.com</a></p>
          <p><Link to="/" className="text-primary hover:underline">← Back to homepage</Link></p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
