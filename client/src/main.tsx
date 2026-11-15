import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider, Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/Auth';
import { MyWork } from './pages/MyWork';
import { Projects } from './pages/Projects';
import { ProjectPage } from './pages/Project';
import { Notifications } from './pages/Notifications';
import { Reports } from './pages/Reports';
import { People } from './pages/People';

// Report browser errors to the server log (see README → Logging). At most 10 per page load.
let reported = 0;
function reportError(message: string, stack?: string, source?: string) {
  if (reported++ >= 10) return;
  const body = JSON.stringify({ message, stack, source, page: location.pathname });
  fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
window.addEventListener('error', (e) => reportError(e.message, e.error?.stack, `${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError(String(e.reason?.message ?? e.reason), e.reason?.stack, 'promise'));

function Gate() {
  const { user, orgs, loading } = useSession();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    );
  }
  const home = orgs[0] ? `/o/${orgs[0].id}/my-work` : '/signup';
  return (
    <Routes>
      <Route path="/o/:orgId" element={<Layout />}>
        <Route index element={<Navigate to="my-work" replace />} />
        <Route path="my-work" element={<MyWork />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="reports" element={<Reports />} />
        <Route path="people" element={<People />} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
