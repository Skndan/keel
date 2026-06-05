import { useState, type FormEvent } from 'react';
import { api, ApiClientError } from '../api/client';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateProjectModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional OAuth + R2 configs
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [githubClientId, setGithubClientId] = useState('');
  const [githubClientSecret, setGithubClientSecret] = useState('');
  const [r2AccessKeyId, setR2AccessKeyId] = useState('');
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState('');
  const [r2Bucket, setR2Bucket] = useState('');
  const [r2Endpoint, setR2Endpoint] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = { name: name.trim() };
      if (googleClientId) body.google_client_id = googleClientId;
      if (googleClientSecret) body.google_client_secret = googleClientSecret;
      if (githubClientId) body.github_client_id = githubClientId;
      if (githubClientSecret) body.github_client_secret = githubClientSecret;
      if (r2AccessKeyId) body.r2_access_key_id = r2AccessKeyId;
      if (r2SecretAccessKey) body.r2_secret_access_key = r2SecretAccessKey;
      if (r2Bucket) body.r2_bucket = r2Bucket;
      if (r2Endpoint) body.r2_endpoint = r2Endpoint;

      const res = await api.post<{ data: { api_key: string; name: string; slug: string } }>(
        '/projects',
        body,
      );

      // Show API key once
      const apiKey = res.data.api_key;
      await navigator.clipboard.writeText(apiKey);
      alert(
        `Project "${res.data.name}" created!\n\nAPI Key (copied to clipboard — save it!):\n${apiKey}`,
      );

      onCreated();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Create Project</h2>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-2 rounded mb-4 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="my-app"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {showAdvanced ? '− Hide' : '+ Show'} OAuth &amp; Storage Config
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t pt-3">
              <p className="text-sm text-gray-500 font-medium">Google OAuth</p>
              <input
                type="text" value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Google Client ID"
              />
              <input
                type="password" value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Google Client Secret"
              />

              <p className="text-sm text-gray-500 font-medium mt-3">GitHub OAuth</p>
              <input
                type="text" value={githubClientId}
                onChange={(e) => setGithubClientId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="GitHub Client ID"
              />
              <input
                type="password" value={githubClientSecret}
                onChange={(e) => setGithubClientSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="GitHub Client Secret"
              />

              <p className="text-sm text-gray-500 font-medium mt-3">Cloudflare R2</p>
              <input
                type="text" value={r2AccessKeyId}
                onChange={(e) => setR2AccessKeyId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="R2 Access Key ID"
              />
              <input
                type="password" value={r2SecretAccessKey}
                onChange={(e) => setR2SecretAccessKey(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="R2 Secret Access Key"
              />
              <input
                type="text" value={r2Bucket}
                onChange={(e) => setR2Bucket(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="R2 Bucket Name"
              />
              <input
                type="text" value={r2Endpoint}
                onChange={(e) => setR2Endpoint(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="R2 Endpoint URL (optional)"
              />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-md hover:bg-gray-300 font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
