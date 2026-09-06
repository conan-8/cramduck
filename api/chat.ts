/**
 * Vercel serverless function: POST /api/chat — Cramduck coach chat proxy.
 * Forwards to Alibaba Cloud Model Studio (see scripts/lib/chat-proxy.ts).
 */
import { handleChat } from '../scripts/lib/chat-proxy.js';

interface Req {
  method?: string;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  let payload: unknown = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
  }
  try {
    const out = await handleChat(payload);
    res.status(out.status).json(out.body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `internal error: ${msg}` });
  }
}
