import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Projects from './pages/Projects';
import TableBrowser from './pages/TableBrowser';
import StorageBrowser from './pages/StorageBrowser';
import WebhookManager from './pages/WebhookManager';
import ProjectSettings from './pages/ProjectSettings';

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />
      <Route element={isAuthenticated ? <Layout /> : <Navigate to="/login" />}>
        <Route path="/" element={<Projects />} />
        <Route path="/project/:slug/tables" element={<TableBrowser />} />
        <Route path="/project/:slug/storage" element={<StorageBrowser />} />
        <Route path="/project/:slug/webhooks" element={<WebhookManager />} />
        <Route path="/project/:slug/settings" element={<ProjectSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
