import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';
import CreateProjectModal from '../components/CreateProjectModal';

interface Project {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get<{ data: Project[] }>('/projects');
      setProjects(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async () => {
    setShowCreate(false);
    setLoading(true);
    await fetchProjects();
    setLoading(false);
  };

  const handleDelete = async (slug: string) => {
    if (!confirm(`Delete project "${slug}"? This will drop the database and cannot be undone.`)) return;

    setDeleting(slug);
    try {
      await api.delete(`/projects/${slug}`);
      setProjects((prev) => prev.filter((p) => p.slug !== slug));
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
        >
          + New Project
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No projects yet</p>
          <p>Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{p.name}</h3>
                  <p className="text-sm text-gray-500">{p.slug}</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Created {new Date(p.created_at).toLocaleDateString()}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Link
                  to={`/project/${p.slug}/tables`}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded font-medium text-gray-700"
                >
                  Tables
                </Link>
                <Link
                  to={`/project/${p.slug}/storage`}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded font-medium text-gray-700"
                >
                  Storage
                </Link>
                <Link
                  to={`/project/${p.slug}/webhooks`}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded font-medium text-gray-700"
                >
                  Webhooks
                </Link>
                <Link
                  to={`/project/${p.slug}/settings`}
                  className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded font-medium text-gray-700"
                >
                  Settings
                </Link>
                <button
                  onClick={() => handleDelete(p.slug)}
                  disabled={deleting === p.slug}
                  className="text-xs bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded font-medium text-red-600 disabled:opacity-50"
                >
                  {deleting === p.slug ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreate}
        />
      )}
    </div>
  );
}
