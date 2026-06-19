import { Link } from 'react-router-dom'
import { Navbar } from '../components/Navbar'
import { Footer } from '../components/Footer'

export function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="container mx-auto max-w-3xl flex-1 px-4 py-24">
        <h1 className="font-display mb-8 text-3xl font-bold">Terms of Service</h1>
        <div className="prose prose-sm max-w-none space-y-4 text-muted-foreground">
          <p>By using FBupload Plus, you agree to these terms. This platform is a neutral SaaS tool for content distribution automation and is not affiliated with Meta.</p>
          <h2 className="text-lg font-semibold text-foreground">User Responsibilities</h2>
          <p>You are solely responsible for all content published through your connected Facebook pages. You must comply with Meta&apos;s Terms of Service, copyright laws, and all applicable regulations.</p>
          <h2 className="text-lg font-semibold text-foreground">Service Description</h2>
          <p>FBupload Plus provides automation tools to connect Facebook pages, download reels from source platforms, and publish on a schedule. Tokens are charged only for successfully published reels.</p>
          <h2 className="text-lg font-semibold text-foreground">Limitation of Liability</h2>
          <p>FBupload Plus acts as a technology conduit. We are not liable for account restrictions, content takedowns, or losses resulting from platform policy changes or user actions.</p>
          <p><Link to="/" className="text-primary hover:underline">← Back to homepage</Link></p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
