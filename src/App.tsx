import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { OwnerRoute } from './components/OwnerRoute'
import { DashboardLayout } from './components/DashboardLayout'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { FacebookCallbackPage } from './pages/FacebookCallbackPage'
import { TermsPage } from './pages/TermsPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { OverviewPage } from './pages/dashboard/OverviewPage'
import { PagesPage } from './pages/dashboard/PagesPage'
import { AddTokensPage } from './pages/dashboard/AddTokensPage'
import { SettingsPage } from './pages/dashboard/SettingsPage'
import { AutoDownloadUploadPage } from './pages/dashboard/AutoDownloadUploadPage'
import { AduPageDetailPage } from './pages/dashboard/AduPageDetailPage'
import { ReelsPage } from './pages/dashboard/ReelsPage'
import { DirectPostPage } from './pages/dashboard/DirectPostPage'
import { BulkDeletePage } from './pages/dashboard/BulkDeletePage'
import { InAppSchedulePage, DirectSchedulePage } from './pages/dashboard/InAppSchedulePage'
import { FacebookByocPage } from './pages/dashboard/FacebookByocPage'
import { ProxyPoolPage } from './pages/dashboard/ProxyPoolPage'
import { TokensPage } from './pages/dashboard/TokensPage'
import { AcceptInvitePage } from './pages/AcceptInvitePage'
import { TeamPage } from './pages/dashboard/TeamPage'
import { AiPostsPage } from './pages/dashboard/AiPostsPage'
import { NewsFeedPage } from './pages/dashboard/NewsFeedPage'
import { PayoutPage } from './pages/dashboard/PayoutPage'
import { YoutubeToolsPage, InstagramToolsPage, YoutubeByocPage, InstagramByocPage } from './pages/dashboard/PlatformPages'
import { OpsLayout, OpsGate } from './pages/ops/OpsLayout'
import { OpsOverviewPage } from './pages/ops/OpsOverviewPage'
import { OpsAgenciesPage, OpsAgencyDetailPage } from './pages/ops/OpsAgenciesPage'
import { OpsJobsPage } from './pages/ops/OpsJobsPage'
import { OpsPagesPage } from './pages/ops/OpsPagesPage'
import { OpsAnalyticsPage } from './pages/ops/OpsAnalyticsPage'
import { OpsAuditPage } from './pages/ops/OpsAuditPage'
import { OpsSystemPage } from './pages/ops/OpsSystemPage'
import { OpsLiveFeedPage } from './pages/ops/OpsLiveFeedPage'
import { OpsSettingsPage } from './pages/ops/OpsSettingsPage'

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
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            <Route path="/facebook/auto-download-upload/:pageId" element={<AduPageDetailPage />} />
            <Route path="/agency/facebook/auto-download-upload" element={<AutoDownloadUploadPage />} />
            <Route path="/agency/facebook/auto-download-upload/:pageId" element={<AduPageDetailPage />} />
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
            <Route path="/facebook/ai-posts" element={<AiPostsPage />} />
            <Route path="/agency/facebook/ai-posts" element={<AiPostsPage />} />
            <Route path="/facebook/news-feed" element={<OwnerRoute><NewsFeedPage /></OwnerRoute>} />
            <Route path="/agency/facebook/news-feed" element={<OwnerRoute><NewsFeedPage /></OwnerRoute>} />
            <Route path="/facebook/payout" element={<PayoutPage />} />
            <Route path="/agency/facebook/payout" element={<PayoutPage />} />

            {/* YouTube platform */}
            <Route path="/youtube/accounts" element={<YoutubeToolsPage />} />
            <Route path="/agency/youtube/accounts" element={<YoutubeToolsPage />} />
            <Route path="/youtube/direct-post" element={<YoutubeToolsPage />} />
            <Route path="/agency/youtube/direct-post" element={<YoutubeToolsPage />} />
            <Route path="/youtube/direct-schedule" element={<YoutubeToolsPage />} />
            <Route path="/agency/youtube/direct-schedule" element={<YoutubeToolsPage />} />
            <Route path="/youtube/inapp-schedule" element={<YoutubeToolsPage />} />
            <Route path="/agency/youtube/inapp-schedule" element={<YoutubeToolsPage />} />

            {/* Instagram platform */}
            <Route path="/instagram/accounts" element={<InstagramToolsPage />} />
            <Route path="/agency/instagram/accounts" element={<InstagramToolsPage />} />
            <Route path="/instagram/direct-post" element={<InstagramToolsPage />} />
            <Route path="/agency/instagram/direct-post" element={<InstagramToolsPage />} />
            <Route path="/instagram/direct-schedule" element={<InstagramToolsPage />} />
            <Route path="/agency/instagram/direct-schedule" element={<InstagramToolsPage />} />
            <Route path="/instagram/inapp-schedule" element={<InstagramToolsPage />} />
            <Route path="/agency/instagram/inapp-schedule" element={<InstagramToolsPage />} />

            {/* Settings & legacy redirects */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/agency/settings" element={<SettingsPage />} />
            <Route path="/settings/team" element={<TeamPage />} />
            <Route path="/agency/settings/team" element={<TeamPage />} />
            <Route path="/settings/facebook-byoc" element={<FacebookByocPage />} />
            <Route path="/agency/settings/facebook-byoc" element={<FacebookByocPage />} />
            <Route path="/settings/proxy-pool" element={<OwnerRoute><ProxyPoolPage /></OwnerRoute>} />
            <Route path="/agency/settings/proxy-pool" element={<OwnerRoute><ProxyPoolPage /></OwnerRoute>} />
            <Route path="/settings/youtube-byoc" element={<YoutubeByocPage />} />
            <Route path="/agency/settings/youtube-byoc" element={<YoutubeByocPage />} />
            <Route path="/settings/instagram-byoc" element={<InstagramByocPage />} />
            <Route path="/agency/settings/instagram-byoc" element={<InstagramByocPage />} />
            <Route path="/reels" element={<Navigate to="/facebook/jobs" replace />} />
            <Route path="/pages" element={<Navigate to="/facebook/accounts" replace />} />
            <Route path="/sources" element={<Navigate to="/facebook/auto-download-upload" replace />} />
            <Route path="/schedule" element={<Navigate to="/facebook/direct-schedule" replace />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="/agency/tokens" element={<TokensPage />} />
            <Route path="/add-tokens" element={<AddTokensPage />} />
            <Route path="/agency/add-tokens" element={<AddTokensPage />} />
          </Route>

          <Route
            element={
              <ProtectedRoute>
                <OpsGate>
                  <OpsLayout />
                </OpsGate>
              </ProtectedRoute>
            }
          >
            <Route path="/ops" element={<OpsOverviewPage />} />
            <Route path="/ops/agencies" element={<OpsAgenciesPage />} />
            <Route path="/ops/agencies/:id" element={<OpsAgencyDetailPage />} />
            <Route path="/ops/pages" element={<OpsPagesPage />} />
            <Route path="/ops/jobs" element={<OpsJobsPage />} />
            <Route path="/ops/live" element={<OpsLiveFeedPage />} />
            <Route path="/ops/settings" element={<OpsSettingsPage />} />
            <Route path="/ops/analytics" element={<OpsAnalyticsPage />} />
            <Route path="/ops/system" element={<OpsSystemPage />} />
            <Route path="/ops/audit" element={<OpsAuditPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
