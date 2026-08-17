import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, readdir, stat } from 'node:fs/promises';
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
const allowedProfiles = (process.env.ALLOWED_PROFILES || 'jarvis,ultron,atlas,forge,sentinel,helios,nexus,athena,ares,scrappy').split(',');
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
    const args = agentId === 'default' ? ['chat', '-q', prompt, '--model', modelId, '--source', 'jarvis-live-ui', '--max-turns', '20', '--quiet'] : ['--profile', agentId, 'chat', '-q', prompt, '--model', modelId, '--source', 'jarvis-live-ui', '--max-turns', '20', '--quiet'];
    const child = spawn('hermes', args, { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
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


const hermesRoot = process.env.HERMES_ROOT || '/root/.hermes';
const hermesProfilesDir = path.join(hermesRoot, 'profiles');
const roleMap = {
  default: 'Core command profile', jarvis: 'Executive orchestration', ultron: 'Technical delivery', atlas: 'Architecture / orchestration', forge: 'Implementation systems', sentinel: 'Monitoring / verification', helios: 'Growth & content', nexus: 'Fiber operations', athena: 'Research / intel', ares: 'Strike team', scrappy: 'Recon / scraping', oracle: 'QA / interface verification'
};
const colors = { default: '#f1e9e0', jarvis: '#8fc7ff', ultron: '#d9564c', atlas: '#9b7cff', forge: '#f59e0b', sentinel: '#5cdab5', helios: '#f0b35a', nexus: '#60a5fa', athena: '#a78bfa', ares: '#ef4444', scrappy: '#10b981', oracle: '#ffffff' };
function parseModelConfig(text) {
  const provider = text.match(/provider:\s*([^\n#]+)/)?.[1]?.trim() || 'unknown';
  const model = text.match(/default:\s*([^\n#]+)/)?.[1]?.trim() || text.match(/model:\s*([^\n#]+)/)?.[1]?.trim() || 'unknown';
  return { provider, model };
}
async function countSkills(profileDir) {
  async function walk(dir) {
    let total = 0; const names = [];
    try {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { const child = await walk(full); total += child.total; names.push(...child.names); }
        else if (ent.name === 'SKILL.md') { total += 1; if (names.length < 8) names.push(path.basename(path.dirname(full))); }
      }
    } catch {}
    return { total, names };
  }
  return walk(path.join(profileDir, 'skills'));
}
function gatewayStatuses() {
  const out = {};
  try {
    const stdout = execFileSync('hermes', ['profile', 'list'], { encoding: 'utf8', timeout: 15000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*[◆ ]?([a-zA-Z0-9_-]+)\s+([^\s]+)\s+(running|stopped|error|disabled|—)/);
      if (m && m[1] !== 'Profile') out[m[1]] = m[3];
    }
  } catch {}
  return out;
}
async function hermesProfileState() {
  const statuses = gatewayStatuses();
  const entries = [];
  try { if (await stat(path.join(hermesRoot, 'config.yaml')).catch(() => null)) entries.push(['default', hermesRoot]); } catch {}
  try { for (const ent of await readdir(hermesProfilesDir, { withFileTypes: true })) if (ent.isDirectory()) entries.push([ent.name, path.join(hermesProfilesDir, ent.name)]); } catch {}
  const order = ['default','jarvis','ultron','atlas','forge','sentinel','helios','nexus','athena','ares','scrappy','oracle'];
  entries.sort((a,b) => (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0])) || a[0].localeCompare(b[0]));
  const profiles = [];
  for (const [id, dir] of entries) {
    const cfg = await readFile(path.join(dir, 'config.yaml'), 'utf8').catch(() => '');
    const { provider, model } = parseModelConfig(cfg);
    const skills = await countSkills(dir);
    profiles.push({ id, name: id.toUpperCase(), role: roleMap[id] || 'Hermes profile', model, provider, gateway: statuses[id] || 'unknown', skills: skills.total, skillNames: skills.names, color: colors[id] || '#8a8f98' });
  }
  const hub = profiles.find((p) => p.id === 'jarvis')?.id || profiles[0]?.id || 'default';
  const edges = profiles.filter((p) => p.id !== hub).map((p) => [hub.toUpperCase(), p.id.toUpperCase()]);
  return { source: 'vps-hermes-profiles', generatedAt: new Date().toISOString(), profiles, edges };
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
app.get('/api/status', async () => ({ profiles: (await hermesProfileState()).profiles.map(({ id, model, gateway }) => ({ id, model, gateway })), tools: ['Hermes Profiles', 'Profile Skills', 'Gateway State', 'Voice', 'Lab Dispatch'], now: new Date().toISOString(), auth: 'disabled' }));

app.all('/api/cadence/*', proxyCadence);
app.get('/api/lab/agents', async (_request, reply) => proxyGateway('/api/agents', reply));
app.get('/api/lab/comms', async (_request, reply) => proxyGateway('/api/comms', reply));
app.get('/api/hermes/state', async () => hermesProfileState());
app.post('/api/hermes/dispatch', async (request, reply) => { const body = z.object({ agentId: z.string(), modelId: z.string().optional(), prompt: z.string().trim().min(1).max(8000) }).parse(request.body); const modelId = body.modelId || 'gpt-5.5'; if (!allowedProfiles.includes(body.agentId) || !allowedModels.includes(modelId)) return reply.code(403).send({ error: 'Agent or model is not allowlisted.' }); const id = `LAB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; const output = await runHermes({ agentId: body.agentId, modelId, prompt: body.prompt }).catch((error) => { throw app.httpErrors.badGateway(error.message); }); return { id, output }; });
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
