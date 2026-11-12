// Executes the same handler used by the Edge entrypoint; no deployment or SQL writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const url = 'https://rrhyglrnlveygyiandhs.supabase.co';
if (process.env.SUPABASE_URL !== url || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Development-only server configuration required');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
if (payload.ref !== 'rrhyglrnlveygyiandhs' || payload.role !== 'service_role') throw Error('Development key scope mismatch');
const source = await readFile(new URL('../supabase/functions/vehicle-entry-signature-media/handler.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { createSignatureMediaHandler } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const handler = createSignatureMediaHandler(createClient, name => process.env[name]);
createServer(async (req, res) => {
  if (req.url !== '/vehicle-entry-signature-media') { res.writeHead(404).end(); return; }
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 4096) { res.writeHead(413).end(); return; } chunks.push(chunk); }
    const request = new Request(`http://127.0.0.1:5196${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end(); }
}).listen(5196, '127.0.0.1', () => console.log('Signature media handler: loopback only, Development only, port 5196'));
