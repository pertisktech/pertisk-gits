import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { AppLayout } from './components/AppLayout'
import { ThemeProvider } from './context/ThemeContext'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { AdminAuthPage } from './pages/admin/AdminAuthPage'
import { CommitDetailPage } from './pages/CommitDetailPage'
import { IssueDetailPage } from './pages/IssueDetailPage'
import { PullRequestDetailPage } from './pages/PullRequestDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { GroupAuditPage } from './pages/GroupAuditPage'
import { GroupSecretsPage } from './pages/GroupSecretsPage'
import { GroupDetailPage } from './pages/GroupDetailPage'
import { GroupMembersPage } from './pages/GroupMembersPage'
import { GroupSettingsPage } from './pages/GroupSettingsPage'
import { GroupsPage } from './pages/GroupsPage'
import { LoginPage } from './pages/LoginPage'
import { NewGroupPage } from './pages/NewGroupPage'
import { NewProjectPage } from './pages/NewProjectPage'
import { PipelineRunDetailPage } from './pages/PipelineRunDetailPage'
import { ProfilePage } from './pages/ProfilePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { RegisterPage } from './pages/RegisterPage'
import { RegistryPage } from './pages/RegistryPage'
import { RunnersPage } from './pages/RunnersPage'
import { SuperAdminRoute } from './routes/SuperAdminRoute'
import { AdminConfigurationPage } from './pages/admin/AdminConfigurationPage'
import { AdminHealthPage } from './pages/admin/AdminHealthPage'
import { AdminSystemPage } from './pages/admin/AdminSystemPage'
import { AdminUsersPage } from './pages/admin/AdminUsersPage'
import { ProtectedRoute } from './routes/ProtectedRoute'

const queryClient = new QueryClient()

const RESERVED_PATHS = new Set([
  'login',
  'register',
  'dashboard',
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

/** /{org}/{repo}.git → project page (browser-friendly clone URL). */
function RedirectShortRepo() {
  const { orgSlug, repoSlug } = useParams()
  if (!orgSlug || !repoSlug || RESERVED_PATHS.has(orgSlug)) {
    return <Navigate to="/dashboard" replace />
  }
  const repo = repoSlug.replace(/\.git$/i, '')
  return <Navigate to={`/groups/${orgSlug}/projects/${repo}`} replace />
}

/** /{org} → group page. */
function RedirectShortOrg() {
  const { orgSlug } = useParams()
  if (!orgSlug || RESERVED_PATHS.has(orgSlug)) {
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
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route element={<AppLayout />}>
                <Route
                  path="/groups/:slug/projects/:projectSlug/commit/:commitSha"
                  element={<CommitDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/issues/:issueNumber"
                  element={<IssueDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/pulls/:pullNumber"
                  element={<PullRequestDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/pipelines/:runId"
                  element={<PipelineRunDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/settings"
                  element={<ProjectDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/commits"
                  element={<ProjectDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/issues"
                  element={<ProjectDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/pulls"
                  element={<ProjectDetailPage />}
                />
                <Route
                  path="/groups/:slug/projects/:projectSlug/pipelines"
                  element={<ProjectDetailPage />}
                />
                <Route path="/groups/:slug/projects/:projectSlug" element={<ProjectDetailPage />} />
                <Route path="/:orgSlug/:repoSlug" element={<RedirectShortRepo />} />
                <Route path="/:orgSlug" element={<RedirectShortOrg />} />
                <Route element={<ProtectedRoute />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/groups" element={<GroupsPage />} />
                  <Route path="/groups/new" element={<NewGroupPage />} />
                  <Route path="/groups/:slug/registry" element={<RegistryPage />} />
                  <Route path="/groups/:slug/registry/:imageName" element={<RegistryPage />} />
                  <Route path="/groups/:slug/settings" element={<GroupSettingsPage />} />
                  <Route path="/groups/:slug/members" element={<GroupMembersPage />} />
                  <Route path="/groups/:slug/audit" element={<GroupAuditPage />} />
                  <Route path="/groups/:slug/secrets" element={<GroupSecretsPage />} />
                  <Route path="/groups/:slug" element={<GroupDetailPage />} />
                  <Route path="/groups/:slug/projects/new" element={<NewProjectPage />} />
                  <Route path="/runners" element={<Navigate to="/admin/runners" replace />} />
                  <Route element={<SuperAdminRoute />}>
                    <Route path="/admin" element={<AdminSystemPage />} />
                    <Route path="/admin/health" element={<AdminHealthPage />} />
                    <Route path="/admin/configuration" element={<AdminConfigurationPage />} />
                    <Route path="/admin/auth" element={<AdminAuthPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/runners" element={<RunnersPage />} />
                  </Route>
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings/auth" element={<Navigate to="/admin/auth" replace />} />
                  <Route path="/organizations" element={<Navigate to="/groups" replace />} />
                  <Route path="/organizations/:slug" element={<RedirectLegacyOrg />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
