import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3003', 10);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(filePath: string): { body: Buffer; contentType: string } | null {
  if (!existsSync(filePath)) return null;

  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);
  return { body, contentType };
}

const server = createServer((req, res) => {
  let url = req.url || '/';

  // Default to index.html
  if (url === '/' || url === '') url = '/index.html';

  // Try dist first (built), then src (dev)
  const distPath = join(__dirname, '..', 'dist', url);
  const srcPath = join(__dirname, url);

  const result = serveStatic(distPath) || serveStatic(srcPath);

  if (result) {
    res.writeHead(200, {
      'Content-Type': result.contentType,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(result.body);
  } else {
    // SPA fallback: serve index.html
    const indexHtml = serveStatic(join(__dirname, '..', 'dist', 'index.html')) ||
      serveStatic(join(__dirname, 'index.html'));

    if (indexHtml) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml.body);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`🎨 Keel Dashboard running on http://0.0.0.0:${PORT}`);
});

const shutdown = () => {
  server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
