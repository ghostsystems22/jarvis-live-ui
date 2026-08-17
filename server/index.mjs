import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8183);
const host = process.env.HOST || '172.17.0.1';
const jarvisBin = process.env.JARVIS_BIN || '/root/.local/bin/jarvis';
const allowedProfiles = (process.env.ALLOWED_PROFILES || 'jarvis,ultron,atlas,forge,sentinel,helios,nexus').split(',');
const allowedModels = (process.env.ALLOWED_MODELS || 'gpt-5.6-terra,gpt-5.5,gpt-5.4,gpt-5.4-mini').split(',');

app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });
app.register(fastifyStatic, {
  root: path.join(root, 'dist'),
  wildcard: false,
  setHeaders: (reply, filePath) => {
    if (filePath.endsWith('sw.js')) reply.header('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  },
});

function profileBin(agentId) { return agentId === 'jarvis' ? jarvisBin : `/root/.local/bin/${agentId}`; }
function runHermes({ agentId, modelId, prompt }) {
  return new Promise((resolve, reject) => {
    const child = spawn(profileBin(agentId), ['chat', '-q', prompt, '--model', modelId, '--source', 'jarvis-live-ui', '--max-turns', '20', '--quiet'], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timeout); if (code === 0) resolve(stdout.trim()); else reject(new Error(`Hermes run failed (${code}). ${stderr.slice(-280)}`)); });
  });
}
async function britishSpeech(text) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-tts-'));
  const out = path.join(dir, 'response.mp3');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('edge-tts', ['--voice', process.env.TTS_VOICE || 'en-GB-RyanNeural', '--text', text.slice(0, 2400), '--write-media', out], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Speech generation failed (${code}). ${stderr.slice(-180)}`)));
    });
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function proxyRaw(targetBase, pathname, reply, init = {}) {
  const upstream = await fetch(`${targetBase}${pathname}`, init);
  const contentType = upstream.headers.get('content-type') || 'application/json';
  reply.code(upstream.status).header('content-type', contentType);
  return reply.send(Buffer.from(await upstream.arrayBuffer()));
}
async function proxyGateway(pathname, reply, init = {}) {
  const gateway = process.env.JARVIS_GATEWAY_URL || 'http://127.0.0.1:8000';
  return proxyRaw(gateway, pathname, reply, init);
}
async function proxyCadence(request, reply) {
  const cadence = process.env.CADENCE_API_URL || 'http://172.17.0.1:8181';
  const stripped = request.raw.url.replace(/^\/api\/cadence/, '/api');
  const body = ['POST', 'PATCH', 'PUT'].includes(request.method) ? JSON.stringify(request.body ?? {}) : undefined;
  return proxyRaw(cadence, stripped, reply, { method: request.method, body, headers: body ? { 'content-type': 'application/json' } : undefined });
}

app.get('/api/health', async () => ({ ok: true, service: 'jarvis-live-ui', auth: 'disabled', at: new Date().toISOString() }));
app.post('/api/login', async () => ({ ok: true, auth: 'disabled' }));
app.post('/api/logout', async () => ({ ok: true, auth: 'disabled' }));
app.get('/api/status', async () => ({ profiles: allowedProfiles.map((id) => ({ id, model: id === 'jarvis' ? 'gpt-5.6-terra' : 'profile configured', gateway: 'managed' })), tools: ['Airtable', 'Cadence', 'Jarvis Gateway', 'Voice', 'Lab Graph'], now: new Date().toISOString(), auth: 'disabled' }));

app.all('/api/cadence/*', proxyCadence);
app.get('/api/lab/agents', async (_request, reply) => proxyGateway('/api/agents', reply));
app.get('/api/lab/comms', async (_request, reply) => proxyGateway('/api/comms', reply));
app.get('/api/proposals', async (_request, reply) => proxyGateway('/api/proposals', reply));
app.post('/api/speak', async (request, reply) => {
  const body = z.object({ text: z.string().trim().min(1).max(2400) }).parse(request.body);
  const audio = await britishSpeech(body.text).catch((error) => { throw app.httpErrors.badGateway(error.message); });
  reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store');
  return reply.send(audio);
});
app.post('/api/run', async (request, reply) => {
  const body = z.object({ agentId: z.string(), modelId: z.string(), prompt: z.string().trim().min(1).max(8000) }).parse(request.body);
  if (!allowedProfiles.includes(body.agentId) || !allowedModels.includes(body.modelId)) return reply.code(403).send({ error: 'Agent or model is not allowlisted.' });
  const id = `RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const output = await runHermes(body).catch((error) => { throw app.httpErrors.badGateway(error.message); });
  return { id, output };
});
app.setErrorHandler((error, _request, reply) => { app.log.error(error); reply.code(error.statusCode || 500).send({ error: error.statusCode === 500 ? 'Internal broker error.' : error.message }); });
app.setNotFoundHandler((request, reply) => request.raw.url?.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'));
app.listen({ port, host });
