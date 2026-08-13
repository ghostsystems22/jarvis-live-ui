import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8183);
const host = process.env.HOST || '172.17.0.1';
const password = process.env.JARVIS_UI_PASSWORD;
const cookieSecret = process.env.COOKIE_SECRET;
const jarvisBin = process.env.JARVIS_BIN || '/root/.local/bin/jarvis';
const allowedProfiles = (process.env.ALLOWED_PROFILES || 'jarvis,ultron,atlas,forge,sentinel,helios,nexus').split(',');
const allowedModels = (process.env.ALLOWED_MODELS || 'gpt-5.6-terra,gpt-5.5,gpt-5.4,gpt-5.4-mini').split(',');

if (!password || !cookieSecret) throw new Error('JARVIS_UI_PASSWORD and COOKIE_SECRET are required.');

app.register(cookie, { secret: cookieSecret });
app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });
app.register(fastifyStatic, { root: path.join(root, 'dist'), wildcard: false });

function sessionValue() { return crypto.createHmac('sha256', cookieSecret).update('jarvis-ui').digest('hex'); }
function authenticated(request) { return request.cookies.jarvis_session === sessionValue(); }
function ensureAuth(request, reply) { if (!authenticated(request)) { reply.code(401).send({ error: 'Authentication required.' }); return false; } return true; }
function constantTimeEqual(a, b) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && crypto.timingSafeEqual(left, right); }
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

app.get('/api/health', async () => ({ ok: true, service: 'jarvis-live-ui' }));
app.post('/api/login', async (request, reply) => {
  const body = z.object({ password: z.string().min(1) }).parse(request.body);
  if (!constantTimeEqual(body.password, password)) return reply.code(401).send({ error: 'Invalid password.' });
  reply.setCookie('jarvis_session', sessionValue(), { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
  return { ok: true };
});
app.post('/api/logout', async (request, reply) => { reply.clearCookie('jarvis_session', { path: '/' }); return { ok: true }; });
app.get('/api/status', async (request, reply) => {
  if (!ensureAuth(request, reply)) return;
  return { profiles: allowedProfiles.map((id) => ({ id, model: id === 'jarvis' ? 'gpt-5.6-terra' : 'profile configured', gateway: 'managed' })), tools: ['Airtable', 'Notion', 'GitHub', 'Browser', 'Telegram'], now: new Date().toISOString() };
});
app.post('/api/speak', async (request, reply) => {
  if (!ensureAuth(request, reply)) return;
  const body = z.object({ text: z.string().trim().min(1).max(2400) }).parse(request.body);
  const audio = await britishSpeech(body.text).catch((error) => { throw app.httpErrors.badGateway(error.message); });
  reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store');
  return reply.send(audio);
});
app.post('/api/run', async (request, reply) => {
  if (!ensureAuth(request, reply)) return;
  const body = z.object({ agentId: z.string(), modelId: z.string(), prompt: z.string().trim().min(1).max(8000) }).parse(request.body);
  if (!allowedProfiles.includes(body.agentId) || !allowedModels.includes(body.modelId)) return reply.code(403).send({ error: 'Agent or model is not allowlisted.' });
  const id = `RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const output = await runHermes(body).catch((error) => { throw app.httpErrors.badGateway(error.message); });
  return { id, output };
});
app.setErrorHandler((error, _request, reply) => { app.log.error(error); reply.code(error.statusCode || 500).send({ error: error.statusCode === 500 ? 'Internal broker error.' : error.message }); });
app.setNotFoundHandler((request, reply) => request.raw.url?.startsWith('/api/') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'));
app.listen({ port, host });
