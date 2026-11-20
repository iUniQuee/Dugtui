/**
 * Локал хөгжүүлэлтийн сервер: `dist/` статик файл + `/api/push/*`.
 *
 * Production дээр Cloudflare Pages Function `functions/api/push/[[path]].js`
 * яг ижил логикийг ажиллуулна (functions/_lib/pushApi.js).
 *
 * Ажиллуулах:
 *   npm run api     → http://localhost:8787 (Vite-ийн /api proxy энэ рүү харна)
 *   npm run start   → build хийсэн dist/ -ийг мөн энэ серверээр үйлчилнэ
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handlePushApi } from '../functions/_lib/pushApi.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.API_PORT || process.env.PORT || 8787);
const PUSH_CONFIGURED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Хүсэлт хэт том байна.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON буруу байна.'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Static files (production: `npm run build` дараа `npm start`)        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    sendJson(res, 404, {
      error: 'dist/ байхгүй байна. Эхлээд `npm run build` хийнэ үү.',
    });
    return;
  }

  const decoded = decodeURIComponent(pathname);
  const target = path.join(DIST, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  let filePath = target;

  if (!existsSync(filePath) || (existsSync(filePath) && !path.extname(filePath))) {
    const indexCandidate = path.join(filePath, 'index.html');
    filePath = existsSync(indexCandidate) ? indexCandidate : path.join(DIST, 'index.html');
  }
  // SPA fallback: hash/query routing ашигладаг тул бүх route index.html руу
  if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html');

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: 'Файл олдсонгүй.' });
  }
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, pushConfigured: PUSH_CONFIGURED });
    }

    if (pathname === '/api/push' || pathname.startsWith('/api/push/')) {
      let bodyText;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        bodyText = JSON.stringify(await readJson(req));
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(','));
      }
      const webResponse = await handlePushApi(
        new Request(url.toString(), { method: req.method, headers, body: bodyText }),
        process.env
      );
      const text = await webResponse.text();
      res.writeHead(webResponse.status, {
        'Content-Type': webResponse.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(text);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'API route олдсонгүй.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    return await serveStatic(req, res, pathname);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Серверийн алдаа.';
    console.error('[api]', message);
    return sendJson(res, 502, { error: message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API + static server: http://0.0.0.0:${PORT}`);
  console.log(
    PUSH_CONFIGURED
      ? 'VAPID түлхүүр тохируулсан — /api/push/notify ажиллана.'
      : 'VAPID түлхүүр дутуу — push мэдэгдэл илгээх боломжгүй (.env-ээ бөглөнө үү).'
  );
});
