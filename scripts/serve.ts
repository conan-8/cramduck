/**
 * serve: dependency-free static server for the Cramduck app (node http only).
 *
 *   npm run serve                  -> http://127.0.0.1:4173
 *   PORT=8080 npm run serve        -> http://127.0.0.1:8080
 *
 * Serves cramduck-mockup/ as THE app: landing at /landing.html, app mockup
 * at / (index.html), built Bluebook simulator at /bluebook-practice-test.html.
 * '/' resolves to index.html, directory paths get their index.html, path
 * traversal is refused, anything else missing is a plain 404. Exit 0.
 *
 * Review API (same-origin, used by the /review route of the built simulator):
 *   GET  /api/curated-status  -> { "<sourceId>": <review block> } for every
 *                                curated record carrying one
 *   POST /api/review          -> { sourceId, status: approved|returned,
 *                                reasons?, note? }; read-modify-writes the
 *                                review block into research/sat/curated/
 *                                ssqb-<id>.json (source of truth).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO_ROOT } from './lib/validate.js';
import { handleChat } from './lib/chat-proxy.js';

const ROOT = path.join(REPO_ROOT, 'cramduck-mockup');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

/** Content-Type by lower-cased extension; unknown types are octet-stream. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function send(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** Review API is also called cross-origin (e.g. the app served by a plain
 *  static server on another port), so API responses carry permissive CORS. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    ...CORS,
  });
  res.end(json);
}

// --- review API ----------------------------------------------------------------

const CURATED_DIR = path.join(REPO_ROOT, 'research', 'sat', 'curated');
const SOURCE_ID_RE = /^ssqb-[0-9a-f]+$/;
const REVIEW_STATUSES = ['approved', 'returned'];
const REVIEW_REASONS = ['info-prompt-split', 'options', 'figure', 'other'];

interface ReviewBlock {
  status: string;
  reasons?: string[];
  note?: string | null;
  at: string;
}

/** Rescanned on every call: files may also change outside the API (imports,
 *  manual edits), so caching would serve stale review state. */
function loadStatuses(): Record<string, ReviewBlock> {
  const out: Record<string, ReviewBlock> = {};
  if (fs.existsSync(CURATED_DIR)) {
    for (const name of fs.readdirSync(CURATED_DIR).filter((n) => n.startsWith('ssqb-') && n.endsWith('.json'))) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(CURATED_DIR, name), 'utf8')) as {
          sourceId?: string;
          review?: ReviewBlock;
        };
        if (rec.sourceId && rec.review) out[rec.sourceId] = rec.review;
      } catch {
        // malformed record: skip
      }
    }
  }
  return out;
}

const ERROR_REPORTS = path.join(REPO_ROOT, 'research', 'sat', 'curate', 'error-reports.jsonl');

/** POST /api/report-error — append a student/tester error report for a question. */
function handleReportError(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 16 * 1024) req.destroy();
  });
  req.on('end', () => {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    const sourceId = typeof p.sourceId === 'string' ? p.sourceId : '';
    const note = typeof p.note === 'string' ? p.note.trim() : '';
    if (!SOURCE_ID_RE.test(sourceId)) {
      sendJson(res, 400, { error: 'sourceId must match ^ssqb-[0-9a-f]+$' });
      return;
    }
    if (!note || note.length > 2000) {
      sendJson(res, 400, { error: 'note must be 1-2000 characters' });
      return;
    }
    fs.mkdirSync(path.dirname(ERROR_REPORTS), { recursive: true });
    fs.appendFileSync(
      ERROR_REPORTS,
      JSON.stringify({ sourceId, note, at: new Date().toISOString() }) + '\n',
    );
    sendJson(res, 200, { ok: true });
  });
}

/** POST /api/review — validate, stamp, and write the review block. */
function handleReview(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) req.destroy();
  });
  req.on('end', () => {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    const sourceId = typeof p.sourceId === 'string' ? p.sourceId : '';
    const status = typeof p.status === 'string' ? p.status : '';
    if (!SOURCE_ID_RE.test(sourceId)) {
      sendJson(res, 400, { error: 'sourceId must match ^ssqb-[0-9a-f]+$' });
      return;
    }
    if (!REVIEW_STATUSES.includes(status)) {
      sendJson(res, 400, { error: 'status must be approved|returned' });
      return;
    }
    let reasons: string[] | undefined;
    if (p.reasons !== undefined) {
      if (!Array.isArray(p.reasons) || p.reasons.some((r) => typeof r !== 'string' || !REVIEW_REASONS.includes(r))) {
        sendJson(res, 400, { error: `reasons must be a subset of ${REVIEW_REASONS.join(', ')}` });
        return;
      }
      reasons = p.reasons as string[];
    }
    const note = p.note === undefined || p.note === null ? null : typeof p.note === 'string' ? p.note : null;

    const file = path.join(CURATED_DIR, `${sourceId}.json`);
    if (!fs.existsSync(file)) {
      sendJson(res, 404, { error: 'no curated record with that sourceId' });
      return;
    }
    const rec = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const review: ReviewBlock = { status, at: new Date().toISOString() };
    if (reasons && reasons.length > 0) review.reasons = reasons;
    review.note = note;
    rec.review = review;
    fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
    sendJson(res, 200, { sourceId, review });
  });
}

/** POST /api/chat — coach chat proxy (OpenRouter). */
function handleChatRoute(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 256 * 1024) req.destroy();
  });
  req.on('end', async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    try {
      const out = await handleChat(payload);
      sendJson(res, out.status, out.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { error: `internal error: ${msg}` });
    }
  });
}

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const requestUri = req.url ?? '/';

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUri, `http://${HOST}:${PORT}`).pathname);
  } catch {
    send(res, 400, 'bad request\n');
    return;
  }

  if (
    (pathname === '/api/review' || pathname === '/api/curated-status' || pathname === '/api/report-error') &&
    method === 'OPTIONS'
  ) {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (method === 'POST' && pathname === '/api/report-error') {
    handleReportError(req, res);
    return;
  }
  if (method === 'GET' && pathname === '/api/curated-status') {
    sendJson(res, 200, loadStatuses());
    return;
  }
  if (method === 'POST' && pathname === '/api/review') {
    handleReview(req, res);
    return;
  }
  if (method === 'POST' && pathname === '/api/chat') {
    handleChatRoute(req, res);
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    send(res, 405, 'method not allowed\n');
    return;
  }

  const filePath = path.normalize(path.join(ROOT, pathname));
  // Path traversal guard: stay inside cramduck-mockup/.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    send(res, 403, 'forbidden\n');
    console.log(`${method} ${requestUri} 403`);
    return;
  }

  try {
    let target = filePath;
    let stat = fs.statSync(target);
    if (stat.isDirectory()) {
      // '/' (or any directory) -> its index.html
      target = path.join(target, 'index.html');
      stat = fs.statSync(target);
    }
    if (!stat.isFile()) {
      send(res, 404, 'not found\n');
      console.log(`${method} ${requestUri} 404`);
      return;
    }
    const body = fs.readFileSync(target);
    const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
    if (method === 'HEAD') res.end();
    else res.end(body);
    console.log(`${method} ${requestUri} 200`);
  } catch {
    send(res, 404, 'not found\n');
    console.log(`${method} ${requestUri} 404`);
  }
});

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  console.error(`serve: invalid PORT ${JSON.stringify(process.env.PORT ?? '')} — use an integer 1-65535`);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`serving cramduck-mockup/ at http://${HOST}:${PORT}`);
});
