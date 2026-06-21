import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardLayout } from './components/DashboardLayout'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { FacebookCallbackPage } from './pages/FacebookCallbackPage'
import { TermsPage } from './pages/TermsPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { OverviewPage } from './pages/dashboard/OverviewPage'
import { PagesPage } from './pages/dashboard/PagesPage'
import { AddTokensPage } from './pages/dashboard/AddTokensPage'
import { SettingsPage } from './pages/dashboard/SettingsPage'
import { AutoDownloadUploadPage } from './pages/dashboard/AutoDownloadUploadPage'
import { ReelsPage } from './pages/dashboard/ReelsPage'
import { DirectPostPage } from './pages/dashboard/DirectPostPage'
import { BulkDeletePage } from './pages/dashboard/BulkDeletePage'
import { InAppSchedulePage, DirectSchedulePage } from './pages/dashboard/InAppSchedulePage'
import { FacebookByocPage } from './pages/dashboard/FacebookByocPage'
import { TokensPage } from './pages/dashboard/TokensPage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { TeamPage } from './pages/dashboard/TeamPage'
import { RoutedFeaturePage } from './pages/dashboard/RoutedFeaturePage'

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/facebook/callback" element={<ProtectedRoute><FacebookCallbackPage /></ProtectedRoute>} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
            <Route path="/agency" element={<OverviewPage />} />
            <Route path="/dashboard" element={<OverviewPage />} />

            {/* Facebook platform */}
            <Route path="/facebook/accounts" element={<PagesPage />} />
            <Route path="/agency/facebook/accounts" element={<PagesPage />} />
            <Route path="/facebook/auto-download-upload" element={<AutoDownloadUploadPage />} />
            <Route path="/agency/facebook/auto-download-upload" element={<AutoDownloadUploadPage />} />
            <Route path="/facebook/jobs" element={<ReelsPage />} />
            <Route path="/agency/facebook/jobs" element={<ReelsPage />} />
            <Route path="/facebook/direct-schedule" element={<DirectSchedulePage />} />
            <Route path="/agency/facebook/direct-schedule" element={<DirectSchedulePage />} />
            <Route path="/facebook/bulk-delete" element={<BulkDeletePage />} />
            <Route path="/agency/facebook/bulk-delete" element={<BulkDeletePage />} />
            <Route path="/facebook/direct-post" element={<DirectPostPage />} />
            <Route path="/agency/facebook/direct-post" element={<DirectPostPage />} />
            <Route path="/facebook/inapp-schedule" element={<InAppSchedulePage />} />
            <Route path="/agency/facebook/inapp-schedule" element={<InAppSchedulePage />} />
            <Route path="/facebook/ai-posts" element={<RoutedFeaturePage />} />
            <Route path="/agency/facebook/ai-posts" element={<RoutedFeaturePage />} />
            <Route path="/facebook/payout" element={<RoutedFeaturePage />} />
            <Route path="/agency/facebook/payout" element={<RoutedFeaturePage />} />

            {/* YouTube platform */}
            <Route path="/youtube/accounts" element={<RoutedFeaturePage />} />
            <Route path="/agency/youtube/accounts" element={<RoutedFeaturePage />} />
            <Route path="/youtube/direct-post" element={<RoutedFeaturePage />} />
            <Route path="/agency/youtube/direct-post" element={<RoutedFeaturePage />} />
            <Route path="/youtube/direct-schedule" element={<RoutedFeaturePage />} />
            <Route path="/agency/youtube/direct-schedule" element={<RoutedFeaturePage />} />
            <Route path="/youtube/inapp-schedule" element={<RoutedFeaturePage />} />
            <Route path="/agency/youtube/inapp-schedule" element={<RoutedFeaturePage />} />

            {/* Instagram platform */}
            <Route path="/instagram/accounts" element={<RoutedFeaturePage />} />
            <Route path="/agency/instagram/accounts" element={<RoutedFeaturePage />} />
            <Route path="/instagram/direct-post" element={<RoutedFeaturePage />} />
            <Route path="/agency/instagram/direct-post" element={<RoutedFeaturePage />} />
            <Route path="/instagram/direct-schedule" element={<RoutedFeaturePage />} />
            <Route path="/agency/instagram/direct-schedule" element={<RoutedFeaturePage />} />
            <Route path="/instagram/inapp-schedule" element={<RoutedFeaturePage />} />
            <Route path="/agency/instagram/inapp-schedule" element={<RoutedFeaturePage />} />

            {/* Settings & legacy redirects */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/agency/settings" element={<SettingsPage />} />
            <Route path="/settings/team" element={<TeamPage />} />
            <Route path="/agency/settings/team" element={<TeamPage />} />
            <Route path="/settings/facebook-byoc" element={<FacebookByocPage />} />
            <Route path="/agency/settings/facebook-byoc" element={<FacebookByocPage />} />
            <Route path="/settings/youtube-byoc" element={<RoutedFeaturePage />} />
            <Route path="/agency/settings/youtube-byoc" element={<RoutedFeaturePage />} />
            <Route path="/settings/instagram-byoc" element={<RoutedFeaturePage />} />
            <Route path="/agency/settings/instagram-byoc" element={<RoutedFeaturePage />} />
            <Route path="/reels" element={<Navigate to="/facebook/jobs" replace />} />
            <Route path="/pages" element={<Navigate to="/facebook/accounts" replace />} />
            <Route path="/sources" element={<Navigate to="/facebook/auto-download-upload" replace />} />
            <Route path="/schedule" element={<Navigate to="/facebook/direct-schedule" replace />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="/agency/tokens" element={<TokensPage />} />
            <Route path="/add-tokens" element={<AddTokensPage />} />
            <Route path="/agency/add-tokens" element={<AddTokensPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
