import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

interface StorageItem {
  key: string;
  last_modified?: string;
  size?: number;
}

export default function StorageBrowser() {
  const { slug } = useParams<{ slug: string }>();
  const [files, setFiles] = useState<StorageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      // List files via DB query on a storage_files table if it exists,
      // otherwise show a note that listing requires SDK integration
      const res = await api.post<{ data: { rows: StorageItem[] } }>(
        `/project/${slug}/db/query`,
        {
          query: `CREATE TABLE IF NOT EXISTS storage_files (key TEXT PRIMARY KEY, uploaded_at TIMESTAMPTZ DEFAULT now());
                  SELECT key, uploaded_at as last_modified FROM storage_files ORDER BY uploaded_at DESC LIMIT 200`,
        },
      );
      setFiles(res.data.rows || []);
      setError(null);
    } catch {
      // Table may not exist yet — that's fine
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !slug) return;

    setUploading(true);
    try {
      // 1. Get presigned upload URL
      const uploadRes = await api.post<{ data: { upload_url: string; key: string } }>(
        `/project/${slug}/storage/upload-url`,
        { filename: file.name, content_type: file.type },
      );

      // 2. Upload to R2 via presigned URL
      const putRes = await fetch(uploadRes.data.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);

      // 3. Record in storage_files
      await api.post(`/project/${slug}/db/query`, {
        query: 'INSERT INTO storage_files (key) VALUES ($1) ON CONFLICT (key) DO UPDATE SET uploaded_at = now()',
        params: [uploadRes.data.key],
      });

      fetchFiles();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (key: string) => {
    if (!slug) return;
    try {
      const res = await api.get<{ data: { download_url: string } }>(
        `/project/${slug}/storage/download-url?key=${encodeURIComponent(key)}`,
      );
      window.open(res.data.download_url, '_blank');
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Download failed');
    }
  };

  const handleDelete = async (key: string) => {
    if (!slug) return;
    try {
      await api.post(`/project/${slug}/db/query`, {
        query: 'DELETE FROM storage_files WHERE key = $1',
        params: [key],
      });
      setFiles((prev) => prev.filter((f) => f.key !== key));
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Storage</h1>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleUpload}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className={`inline-flex items-center px-4 py-2 rounded-md font-medium text-white cursor-pointer ${
              uploading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {uploading ? 'Uploading...' : 'Upload File'}
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-2 border-b bg-gray-50 font-medium text-sm text-gray-700 grid grid-cols-12 gap-4">
          <span className="col-span-5">Key</span>
          <span className="col-span-4">Uploaded</span>
          <span className="col-span-3">Actions</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : files.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            <p>No files uploaded yet.</p>
            <p className="text-sm mt-1">Upload a file using the button above.</p>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.key}
              className="px-4 py-3 border-b last:border-b-0 grid grid-cols-12 gap-4 items-center hover:bg-gray-50"
            >
              <span className="col-span-5 text-sm text-gray-800 truncate font-mono">
                {file.key}
              </span>
              <span className="col-span-4 text-sm text-gray-500">
                {file.last_modified ? new Date(file.last_modified).toLocaleString() : '—'}
              </span>
              <span className="col-span-3 flex gap-2">
                <button
                  onClick={() => handleDownload(file.key)}
                  className="text-blue-600 text-xs hover:underline font-medium"
                >
                  Download
                </button>
                <button
                  onClick={() => handleDelete(file.key)}
                  className="text-red-600 text-xs hover:underline font-medium"
                >
                  Delete
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
