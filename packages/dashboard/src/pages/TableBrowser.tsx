import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiClientError } from '../api/client';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

export default function TableBrowser() {
  const { slug } = useParams<{ slug: string }>();
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [insertMode, setInsertMode] = useState(false);
  const [sqlQuery, setSqlQuery] = useState('');
  const [showRawQuery, setShowRawQuery] = useState(false);

  const fetchTables = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await api.post<{ data: { rows: { table_name: string }[] } }>(
        `/project/${slug}/db/query`,
        { query: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name" },
      );
      setTables((res.data.rows || []).map((r) => r.table_name));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load tables');
    }
  }, [slug]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const fetchColumns = useCallback(async (table: string) => {
    if (!slug) return;
    try {
      const res = await api.post<{ data: { rows: unknown[]; fields: { name: string }[] } }>(
        `/project/${slug}/db/query`,
        {
          query: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
          params: [table],
        },
      );
      setColumns(res.data.rows.map((r: unknown) => r as ColumnInfo));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load columns');
    }
  }, [slug]);

  const fetchRows = useCallback(async (table: string) => {
    if (!slug) return;
    setLoading(true);
    try {
      const res = await api.post<{ data: { rows: Record<string, unknown>[] } }>(
        `/project/${slug}/db/query`,
        { query: `SELECT * FROM "${table}" LIMIT 100` },
      );
      setRows(res.data.rows || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const selectTable = (table: string) => {
    setSelectedTable(table);
    setEditingRow(null);
    setInsertMode(false);
    fetchColumns(table);
    fetchRows(table);
  };

  const runRawQuery = async () => {
    if (!slug || !sqlQuery.trim()) return;
    setLoading(true);
    try {
      const res = await api.post<{ data: { rows: Record<string, unknown>[]; fields: { name: string }[] } }>(
        `/project/${slug}/db/query`,
        { query: sqlQuery },
      );
      setRows(res.data.rows || []);
      if (res.data.fields) {
        setColumns(res.data.fields.map((f) => ({ column_name: f.name, data_type: '', is_nullable: 'YES' })));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const deleteRow = async (rowIndex: number) => {
    if (!slug || !selectedTable) return;
    const row = rows[rowIndex];
    // Find a primary key-like column or use first column
    const firstCol = columns[0]?.column_name;
    if (!firstCol) return;

    try {
      await api.post(`/project/${slug}/db/query`, {
        query: `DELETE FROM "${selectedTable}" WHERE "${firstCol}" = $1`,
        params: [row[firstCol]],
      });
      fetchRows(selectedTable);
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Delete failed');
    }
  };

  const insertRow = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!slug || !selectedTable) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const cols: string[] = [];
    const placeholders: string[] = [];
    const params: string[] = [];
    let i = 1;

    columns.forEach((col) => {
      const val = data.get(col.column_name) as string;
      if (val) {
        cols.push(`"${col.column_name}"`);
        placeholders.push(`$${i}`);
        params.push(val);
        i++;
      }
    });

    if (cols.length === 0) return;

    try {
      await api.post(`/project/${slug}/db/query`, {
        query: `INSERT INTO "${selectedTable}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        params,
      });
      setInsertMode(false);
      fetchRows(selectedTable);
      form.reset();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Insert failed');
    }
  };

  const updateRow = async (e: React.FormEvent<HTMLFormElement>, rowIndex: number) => {
    e.preventDefault();
    if (!slug || !selectedTable) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const firstCol = columns[0]?.column_name;
    if (!firstCol) return;

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    columns.slice(1).forEach((col) => {
      sets.push(`"${col.column_name}" = $${i}`);
      params.push(data.get(col.column_name) || null);
      i++;
    });
    params.push(rows[rowIndex][firstCol]);

    try {
      await api.post(`/project/${slug}/db/query`, {
        query: `UPDATE "${selectedTable}" SET ${sets.join(', ')} WHERE "${firstCol}" = $${i}`,
        params,
      });
      setEditingRow(null);
      fetchRows(selectedTable);
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : 'Update failed');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Table Browser</h1>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded mb-4 text-sm">{error}</div>
      )}

      {/* Raw SQL toggle */}
      <div className="mb-4">
        <button
          onClick={() => setShowRawQuery(!showRawQuery)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {showRawQuery ? 'Hide' : 'Show'} SQL Query Editor
        </button>
        {showRawQuery && (
          <div className="mt-2 flex gap-2">
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              rows={3}
              placeholder="SELECT * FROM ..."
            />
            <button
              onClick={runRawQuery}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium self-end"
            >
              {loading ? 'Running...' : 'Run'}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Table list */}
        <div className="w-56 flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-4 py-2 border-b bg-gray-50 font-medium text-sm text-gray-700">
              Tables
            </div>
            {tables.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500">No tables</div>
            ) : (
              tables.map((t) => (
                <button
                  key={t}
                  onClick={() => selectTable(t)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                    selectedTable === t ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  {t}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Data view */}
        <div className="flex-1 min-w-0">
          {!selectedTable ? (
            <div className="text-center py-16 text-gray-500">Select a table to browse</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-lg">{selectedTable}</h2>
                <button
                  onClick={() => setInsertMode(!insertMode)}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700"
                >
                  + Insert Row
                </button>
              </div>

              {/* Insert form */}
              {insertMode && (
                <form onSubmit={insertRow} className="bg-green-50 p-4 rounded mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {columns.map((col) => (
                      <div key={col.column_name}>
                        <label className="block text-xs font-medium text-gray-600">
                          {col.column_name}
                        </label>
                        <input
                          name={col.column_name}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded text-sm">
                      Insert
                    </button>
                    <button type="button" onClick={() => setInsertMode(false)} className="bg-gray-200 px-3 py-1 rounded text-sm">
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Table */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        {columns.map((col) => (
                          <th key={col.column_name} className="px-4 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                            {col.column_name}
                          </th>
                        ))}
                        <th className="px-4 py-2 w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-gray-500">
                            No rows
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            {editingRow === i ? (
                              <>
                                {columns.map((col) => (
                                  <td key={col.column_name} className="px-4 py-1">
                                    <input
                                      name={col.column_name}
                                      defaultValue={String(row[col.column_name] ?? '')}
                                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                    />
                                  </td>
                                ))}
                                <td className="px-4 py-1">
                                  <div className="flex gap-1">
                                    <button
                                      onClick={(e) => {
                                        const form = (e.target as HTMLElement).closest('tr')?.querySelector('form');
                                        if (form) updateRow({ preventDefault: () => {} } as React.FormEvent<HTMLFormElement>, i);
                                      }}
                                      className="text-green-600 text-xs hover:underline"
                                    >
                                      Save
                                    </button>
                                    <button onClick={() => setEditingRow(null)} className="text-gray-500 text-xs hover:underline">
                                      Cancel
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                {columns.map((col) => (
                                  <td key={col.column_name} className="px-4 py-2 text-gray-700 max-w-xs truncate">
                                    {String(row[col.column_name] ?? 'NULL')}
                                  </td>
                                ))}
                                <td className="px-4 py-2">
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setEditingRow(i)}
                                      className="text-blue-600 text-xs hover:underline"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => deleteRow(i)}
                                      className="text-red-600 text-xs hover:underline"
                                    >
                                      Del
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
