import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

interface ProjectDetails {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  db_name?: string;
  db_user?: string;
}

export default function ProjectSettings() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [configs, setConfigs] = useState({
    google_client_id: '',
    google_client_secret: '',
    github_client_id: '',
    github_client_secret: '',
    r2_access_key_id: '',
    r2_secret_access_key: '',
    r2_bucket: '',
    r2_endpoint: '',
  });

  const fetchProject = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await api.get<{ data: ProjectDetails }>(`/projects/${slug}`);
      setProject(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const handleCopyApiKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveConfigs = async () => {
    if (!slug) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      // Update configs via the gateway PATCH endpoint (encrypted at rest)
      await api.patch(`/projects/${slug}`, configs);

      setSaveMessage('Settings saved!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage(err instanceof ApiClientError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 px-4 py-3 rounded">{error}</div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Project Settings</h1>

      {/* Project Info */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Project Info</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Name</dt>
            <dd className="font-medium text-gray-900">{project?.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Slug</dt>
            <dd className="font-medium text-gray-900 font-mono">{project?.slug}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Database</dt>
            <dd className="font-medium text-gray-900 font-mono text-xs">
              {project?.db_name || `keel_p_${project?.slug}`}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="font-medium text-gray-900">
              {project?.created_at ? new Date(project.created_at).toLocaleDateString() : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {/* API Key */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">API Key</h2>
        <p className="text-sm text-gray-500 mb-3">
          Your API key was shown once when the project was created. Enter it here to use the
          Flutter SDK or API clients.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your API key (keel_...)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
          />
          <button
            onClick={handleCopyApiKey}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Connection string: {`${window.location.origin}/v1/project/${slug}/db/query`}
        </p>
      </div>

      {/* OAuth + R2 Configs */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">OAuth &amp; Storage Config</h2>
        <p className="text-sm text-gray-500 mb-4">
          These are encrypted at rest. Provide your own OAuth and R2 credentials for this
          project.
        </p>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Google OAuth</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Google Client ID"
                value={configs.google_client_id}
                onChange={(e) => setConfigs({ ...configs, google_client_id: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="password"
                placeholder="Google Client Secret"
                value={configs.google_client_secret}
                onChange={(e) => setConfigs({ ...configs, google_client_secret: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">GitHub OAuth</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="GitHub Client ID"
                value={configs.github_client_id}
                onChange={(e) => setConfigs({ ...configs, github_client_id: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="password"
                placeholder="GitHub Client Secret"
                value={configs.github_client_secret}
                onChange={(e) => setConfigs({ ...configs, github_client_secret: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Cloudflare R2</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="R2 Access Key ID"
                value={configs.r2_access_key_id}
                onChange={(e) => setConfigs({ ...configs, r2_access_key_id: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="password"
                placeholder="R2 Secret Access Key"
                value={configs.r2_secret_access_key}
                onChange={(e) => setConfigs({ ...configs, r2_secret_access_key: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="text"
                placeholder="R2 Bucket Name"
                value={configs.r2_bucket}
                onChange={(e) => setConfigs({ ...configs, r2_bucket: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="text"
                placeholder="R2 Endpoint URL (optional)"
                value={configs.r2_endpoint}
                onChange={(e) => setConfigs({ ...configs, r2_endpoint: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleSaveConfigs}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saveMessage && (
            <span
              className={`text-sm ${
                saveMessage.includes('failed') ? 'text-red-600' : 'text-green-600'
              }`}
            >
              {saveMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
