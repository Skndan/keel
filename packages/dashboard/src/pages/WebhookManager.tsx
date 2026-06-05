import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

interface Webhook {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: boolean;
  created_at: string;
}

export default function WebhookManager() {
  const { slug } = useParams<{ slug: string }>();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState('*');
  const [formSecret, setFormSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      // Ensure webhooks table exists, then query
      await api.post(`/project/${slug}/db/query`, {
        query: `CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          url TEXT NOT NULL,
          events TEXT NOT NULL DEFAULT '*',
          secret TEXT,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now()
        )`,
      });

      const res = await api.post<{ data: { rows: Webhook[] } }>(
        `/project/${slug}/db/query`,
        { query: 'SELECT * FROM webhooks ORDER BY created_at DESC' },
      );
      setWebhooks(res.data.rows || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !formUrl.trim()) return;

    setSubmitting(true);
    try {
      const res = await api.post<{ data: { rows: Webhook[] } }>(
        `/project/${slug}/db/query`,
        {
          query: 'INSERT INTO webhooks (url, events, secret) VALUES ($1, $2, $3) RETURNING *',
          params: [formUrl.trim(), formEvents.trim(), formSecret || null],
        },
      );
      setWebhooks((prev) => [...(res.data.rows || []), ...prev]);
      setShowForm(false);
      setFormUrl('');
      setFormEvents('*');
      setFormSecret('');
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    if (!slug) return;
    try {
      await api.post(`/project/${slug}/db/query`, {
        query: 'UPDATE webhooks SET active = $1 WHERE id = $2',
        params: [!active, id],
      });
      setWebhooks((prev) =>
        prev.map((w) => (w.id === id ? { ...w, active: !active } : w)),
      );
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Toggle failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!slug || !confirm('Delete this webhook?')) return;
    try {
      await api.post(`/project/${slug}/db/query`, {
        query: 'DELETE FROM webhooks WHERE id = $1',
        params: [id],
      });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
        >
          + Add Webhook
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="https://example.com/webhook"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Events</label>
              <input
                type="text"
                value={formEvents}
                onChange={(e) => setFormEvents(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="*"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Secret (optional)</label>
              <input
                type="text"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Signing secret"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              {submitting ? 'Creating...' : 'Create Webhook'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Webhook list */}
      <div className="bg-white border border-gray-200 rounded-lg">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">No webhooks configured</div>
        ) : (
          webhooks.map((wh) => (
            <div
              key={wh.id}
              className="px-4 py-3 border-b last:border-b-0 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{wh.url}</span>
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs rounded-full font-medium ${
                      wh.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {wh.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-500">Events: {wh.events}</span>
                  {wh.secret && <span className="text-xs text-gray-400">Signed</span>}
                  <span className="text-xs text-gray-400">
                    {wh.created_at ? new Date(wh.created_at).toLocaleDateString() : ''}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 ml-4 flex-shrink-0">
                <button
                  onClick={() => handleToggle(wh.id, wh.active)}
                  className={`text-xs px-2 py-1 rounded font-medium ${
                    wh.active
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {wh.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleDelete(wh.id)}
                  className="text-xs bg-red-50 text-red-600 px-2 py-1 rounded hover:bg-red-100 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
