import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { SessionExpiryHandler } from './auth/SessionExpiryHandler'
import { AppLayout } from './components/AppLayout'
import { ThemeProvider } from './context/ThemeContext'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { ActivityApproveUsersPage } from './pages/activity/ActivityApproveUsersPage'
import { ActivityMergeRequestsPage } from './pages/activity/ActivityMergeRequestsPage'
import { AdminAuthPage } from './pages/admin/AdminAuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { GroupsPage } from './pages/GroupsPage'
import { LoginPage } from './pages/LoginPage'
import { NewGroupPage } from './pages/NewGroupPage'
import { ProfilePage } from './pages/ProfilePage'
import { RegisterPage } from './pages/RegisterPage'
import { RunnersPage } from './pages/RunnersPage'
import { SuperAdminRoute } from './routes/SuperAdminRoute'
import { AdminBackupPage } from './pages/admin/AdminBackupPage'
import { AdminConfigurationPage } from './pages/admin/AdminConfigurationPage'
import { AdminHealthPage } from './pages/admin/AdminHealthPage'
import { AdminSystemPage } from './pages/admin/AdminSystemPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { GroupAreaRouter } from './routes/GroupAreaRouter'
import { ProtectedRoute } from './routes/ProtectedRoute'

const queryClient = new QueryClient()

const RESERVED_PATHS = new Set([
  'login',
  'register',
  'dashboard',
  'activity',
  'groups',
  'runners',
  'profile',
  'settings',
  'auth',
  'organizations',
  'api',
  'health',
  'assets',
])

function RedirectLegacyOrg() {
  const { slug } = useParams()
  return <Navigate to={`/groups/${slug}`} replace />
}

/** /{org}/{repo}.git → project page (single-segment org; nested groups use /groups/a/b/...). */
function RedirectShortRepo() {
  const { orgSlug, repoSlug } = useParams()
  if (!orgSlug || !repoSlug || RESERVED_PATHS.has(orgSlug) || orgSlug === 'groups') {
    return <Navigate to="/dashboard" replace />
  }
  const repo = repoSlug.replace(/\.git$/i, '')
  return <Navigate to={`/groups/${orgSlug}/projects/${repo}`} replace />
}

/** /{org} → group page. */
function RedirectShortOrg() {
  const { orgSlug } = useParams()
  if (!orgSlug || RESERVED_PATHS.has(orgSlug) || orgSlug === 'groups') {
    return <Navigate to="/dashboard" replace />
  }
  return <Navigate to={`/groups/${orgSlug}`} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <SessionExpiryHandler />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route element={<AppLayout />}>
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/groups" element={<GroupsPage />} />
                  <Route path="/groups/new" element={<NewGroupPage />} />
                  <Route path="/activity" element={<Navigate to="/activity/merge-requests" replace />} />
                  <Route path="/activity/merge-requests" element={<ActivityMergeRequestsPage />} />
                  <Route element={<SuperAdminRoute />}>
                    <Route path="/activity/approve-users" element={<ActivityApproveUsersPage />} />
                  </Route>
                  <Route path="/runners" element={<Navigate to="/admin/runners" replace />} />
                  <Route element={<SuperAdminRoute />}>
                    <Route path="/admin" element={<AdminSystemPage />} />
                    <Route path="/admin/health" element={<AdminHealthPage />} />
                    <Route path="/admin/configuration" element={<AdminConfigurationPage />} />
                    <Route path="/admin/auth" element={<AdminAuthPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/backups" element={<AdminBackupPage />} />
                    <Route path="/admin/runners" element={<RunnersPage />} />
                  </Route>
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings/auth" element={<Navigate to="/admin/auth" replace />} />
                  <Route path="/organizations" element={<Navigate to="/groups" replace />} />
                  <Route path="/organizations/:slug" element={<RedirectLegacyOrg />} />
                </Route>
                <Route path="/groups/*" element={<GroupAreaRouter />} />
                <Route path="/:orgSlug/:repoSlug" element={<RedirectShortRepo />} />
                <Route path="/:orgSlug" element={<RedirectShortOrg />} />
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
