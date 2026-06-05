import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export default function Layout() {
  const { email, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-xl font-bold text-blue-600">
            ⚓ Keel
          </Link>
          {location.pathname !== '/' && (
            <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
              ← Back to Projects
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{email}</span>
          <button
            onClick={logout}
            className="text-sm text-red-600 hover:text-red-800"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Sub-nav when inside a project */}
      {location.pathname.startsWith('/project/') && (
        <nav className="bg-white border-b border-gray-200 px-6">
          <div className="flex gap-1 -mb-px">
            {[
              ['tables', 'Tables'],
              ['storage', 'Storage'],
              ['webhooks', 'Webhooks'],
              ['settings', 'Settings'],
            ].map(([path, label]) => {
              const slug = location.pathname.split('/')[2];
              const href = `/project/${slug}/${path}`;
              const active = location.pathname.endsWith(`/${path}`);
              return (
                <Link
                  key={path}
                  to={href}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${
                    active
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
