import React, { useEffect, useMemo, useRef, useState } from 'react';
import { agents, models, type AgentId, type ModelId } from './lib/commandContract';
import { createVoiceCapture } from './lib/voiceCapture';
import { getCoreTone, getDictationHotkey, normalizeVoiceText, parseWakeCommand, shouldKeepLiveVoiceArmed, shouldListenContinuously, shouldSpeakResponse, type VoiceMode } from './lib/liveVoice';
import { speechText } from './lib/speech';
import { cadenceApi, type ApiRecord, type Bootstrap, type TaskFields } from './lib/cadenceApi';
import { buildPlan, type DayPlan, type PlanTask } from './lib/planEngine';
import ParticleSphere from './components/ParticleSphere';
import ProductivitySection from './components/ProductivitySection';
import './styles.css';

type SpeechRecognitionWord = { transcript: string; isFinal?: boolean };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionWord>> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
type Section = 'command' | 'cadence' | 'lab';
type Run = { id: string; status: 'idle' | 'planning' | 'running' | 'speaking' | 'done' | 'error'; message: string; output?: string; at: string };
type SystemStatus = { profiles: Array<{ id: string; model: string; gateway: string }>; tools: string[]; now: string; auth?: string };
type AirtableRecord<T = Record<string, unknown>> = { id: string; fields: T; createdTime?: string };
type AirtableList<T = Record<string, unknown>> = { records: Array<AirtableRecord<T>>; error?: unknown; status_code?: number };
type CadenceState = { loading: boolean; error: string; data: Bootstrap | null };
type HermesProfile = { id: string; name: string; role: string; model: string; provider: string; gateway: string; skills: number; skillNames: string[]; color: string };
type HermesState = { source: string; generatedAt: string; profiles: HermesProfile[]; edges: string[][] };
type LabState = { loading: boolean; error: string; data: HermesState | null; output: string; running: boolean };

const today = new Date().toISOString().slice(0, 10);
const nav = [{ id: 'command', label: 'COMMAND' }, { id: 'cadence', label: 'CADENCE' }, { id: 'lab', label: 'LAB' }] as const;
const voiceBars = [6, 14, 9, 18, 11, 16, 8, 15, 10, 17, 7, 13, 9, 12];

async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, ...init }); if (!response.ok) throw new Error((await response.json().catch(() => ({ error: 'Request failed' }))).error ?? 'Request failed'); return response.json() as Promise<T>; }
function text(value: unknown, fallback = '—') { return Array.isArray(value) ? String(value[0] ?? fallback) : typeof value === 'string' && value.trim() ? value : fallback; }
function hours(value: number) { return `${Number.isInteger(value) ? value : value.toFixed(1)}h`; }
function dateLabel(day: string) { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`)); }
function phaseName(phaseId: string | undefined, phases: ApiRecord[]) { return phases.find((phase) => phase.id === phaseId)?.fields.name as string | undefined; }
function projectName(projectId: string | undefined, projects: ApiRecord[]) { return projects.find((project) => project.id === projectId)?.fields.name as string | undefined; }


function hexToRgb(hex: string) {
  const clean = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(clean, 16);
  if (Number.isNaN(value)) return { r: 143, g: 199, b: 255 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function HermesMoleculeLayer({ profiles, selectedId, onSelect }: { profiles: HermesProfile[]; selectedId: string; onSelect: (profile: HermesProfile) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const hitRef = useRef<Array<{ id: string; x: number; y: number; r: number; profile: HermesProfile }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const particles = profiles.flatMap((profile, idx) => {
      const rand = seeded(profile.id);
      const count = profile.id === 'jarvis' ? 720 : profile.id === 'default' ? 620 : 380;
      return Array.from({ length: count }, (_, i) => {
        const golden = Math.PI * (3 - Math.sqrt(5));
        const yy = 1 - (i / Math.max(1, count - 1)) * 2;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        return {
          profile,
          idx,
          yUnit: yy,
          theta: golden * i + rand() * 0.4,
          shell: rr,
          jitter: (rand() - 0.5) * 0.18,
          size: 0.45 + rand() * 1.15,
          alpha: 0.18 + rand() * 0.58,
          drift: rand() * Math.PI * 2,
        };
      });
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#020304';
      ctx.fillRect(0, 0, w, h);

      const nodes = profiles.map((profile, idx) => {
        const n = Math.max(1, profiles.length - 1);
        const hub = profile.id === 'jarvis' || (!profiles.some((p) => p.id === 'jarvis') && idx === 0);
        const ringIndex = hub ? -1 : profiles.filter((p) => p.id !== 'jarvis').findIndex((p) => p.id === profile.id);
        const angle = hub ? 0 : -Math.PI / 2 + (ringIndex / n) * Math.PI * 2;
        const radius = Math.min(w, h) * (hub ? 0 : 0.34);
        return {
          profile,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          r: hub ? 76 : 46,
          hub,
        };
      });
      hitRef.current = nodes.map((node) => ({ id: node.profile.id, x: node.x, y: node.y, r: node.r + 18, profile: node.profile }));

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.setLineDash([4, 9]);
      ctx.lineWidth = 0.6;
      for (const node of nodes) {
        if (node.hub) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(node.x, node.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.34, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(143,199,255,0.11)';
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const t = now * 0.001;
      for (const p of particles) {
        const node = nodes.find((candidate) => candidate.profile.id === p.profile.id);
        if (!node) continue;
        const active = selectedId === p.profile.id;
        const running = p.profile.gateway === 'running';
        const spin = t * (running ? 0.45 : 0.16) + p.idx * 0.25;
        const theta = p.theta + spin;
        const z = Math.sin(theta) * p.shell;
        const depth = (z + 1) / 2;
        const drift = Math.sin(t * 0.7 + p.drift) * node.r * 0.035;
        const px = node.x + (Math.cos(theta) * p.shell + p.jitter) * node.r + drift;
        const py = node.y - p.yUnit * node.r + Math.cos(t * 0.55 + p.drift) * node.r * 0.025;
        const rgb = active ? hexToRgb(p.profile.color) : { r: 238, g: 238, b: 238 };
        const alpha = p.alpha * (0.24 + depth * 0.76) * (running ? 1 : 0.48) * (active ? 1.35 : 0.72);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(1, alpha)})`;
        ctx.arc(px, py, p.size * (0.7 + depth * 1.1) * (active ? 1.22 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.font = "700 10px 'IBM Plex Mono', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const node of nodes) {
        const active = selectedId === node.profile.id;
        const rgb = hexToRgb(node.profile.color);
        ctx.strokeStyle = active ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.9)` : 'rgba(255,255,255,0.16)';
        ctx.lineWidth = active ? 1.2 : 0.55;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = active ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.95)` : 'rgba(241,233,224,0.72)';
        ctx.fillText(node.profile.name, node.x, node.y + node.r + 32);
        ctx.fillStyle = 'rgba(241,233,224,0.36)';
        ctx.font = "700 8px 'IBM Plex Mono', monospace";
        ctx.fillText(`${node.profile.skills} SKILLS · ${node.profile.model.slice(0, 18)}`, node.x, node.y + node.r + 46);
        ctx.font = "700 10px 'IBM Plex Mono', monospace";
      }
      ctx.restore();

      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      ro.disconnect();
    };
  }, [profiles, selectedId]);

  function click(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitRef.current.find((node) => Math.hypot(node.x - x, node.y - y) <= node.r);
    if (hit) onSelect(hit.profile);
  }

  return <canvas ref={canvasRef} className="hermes-molecule-canvas" onClick={click} />;
}

function CapacityDial({ value, committed, template, size = 'lg', onChange, readOnly = false }: { value: number; committed: number; template: number; size?: 'lg' | 'md' | 'sm'; onChange?: (hours: number) => void; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value); useEffect(() => setDraft(value), [value]);
  const diameter = size === 'lg' ? 184 : size === 'md' ? 108 : 56;
  const snap = (next: number) => Math.max(0, Math.min(12, Math.round(next * 2) / 2));
  const fromPointer = (event: React.PointerEvent<SVGSVGElement>) => { const box = event.currentTarget.getBoundingClientRect(); const x = ((event.clientX - box.left) / box.width) * 100 - 50; const y = ((event.clientY - box.top) / box.height) * 100 - 50; let angle = Math.atan2(y, x) * 180 / Math.PI; if (angle < 135) angle += 360; return snap(((angle - 135) / 270) * 12); };
  const commit = (next: number) => { const value = snap(next); setDraft(value); onChange?.(value); };
  const ratio = value ? committed / value : committed ? Infinity : 0;
  return <div className={`cad-dial dial-${size}`} style={{ width: diameter }}><svg viewBox="0 0 100 100" role="slider" aria-valuemin={0} aria-valuemax={12} aria-valuenow={draft} aria-label="Available hours" tabIndex={readOnly ? -1 : 0} onPointerDown={(event) => { if (readOnly) return; event.currentTarget.setPointerCapture(event.pointerId); setDraft(fromPointer(event)); }} onPointerMove={(event) => { if (!readOnly && event.currentTarget.hasPointerCapture(event.pointerId)) setDraft(fromPointer(event)); }} onPointerUp={(event) => { if (!readOnly) commit(fromPointer(event)); }} onWheel={(event) => { if (!readOnly) { event.preventDefault(); commit(draft + (event.deltaY > 0 ? -0.5 : 0.5)); } }} onKeyDown={(event) => { if (readOnly) return; if (event.key === 'ArrowUp') commit(draft + (event.shiftKey ? 1 : 0.5)); if (event.key === 'ArrowDown') commit(draft - (event.shiftKey ? 1 : 0.5)); if (event.key === 'Home') commit(0); if (event.key === 'End') commit(template); }}>
    <path className="dial-track" d="M 22.4 77.6 A 39 39 0 1 1 77.6 77.6" fill="none" pathLength="100" />
    <path className="dial-budget" d="M 22.4 77.6 A 39 39 0 1 1 77.6 77.6" fill="none" pathLength="100" strokeDasharray={`${draft / 12 * 100} 100`} />
    <path className={`dial-committed ${ratio > 1 ? 'over' : ratio >= 0.9 ? 'tight' : ''}`} d="M 28 72 A 31 31 0 1 1 72 72" fill="none" pathLength="100" strokeDasharray={`${Math.min(1, committed / 12) * 100} 100`} />
  </svg>{size !== 'sm' && <div className="dial-value"><b>{hours(draft)}</b><small>{hours(committed)} committed</small></div>}</div>;
}

function DayList({ day, tasks, phases, projects, pin, openPhase }: { day: DayPlan; tasks: ApiRecord<TaskFields>[]; phases: ApiRecord[]; projects: ApiRecord[]; pin: (task: ApiRecord<TaskFields>) => void; openPhase: (id: string) => void }) {
  const scheduled = day.items.filter((item) => ['scheduled', 'pinned', 'split'].includes(item.state));
  const deferred = day.items.filter((item) => !['scheduled', 'pinned', 'split'].includes(item.state));
  const row = (item: DayPlan['items'][number]) => { const task = tasks.find((candidate) => candidate.id === item.taskId); if (!task) return null; const phase = task.fields.phase?.[0]; const project = task.fields.project?.[0]; return <article className={`plan-row ${item.state}`} key={`${item.taskId}-${item.segmentIndex ?? 0}`}><div><b>{task.fields.name}</b><div className="row-meta"><span>{task.fields.priority ?? 'P2'}</span>{project && <span>{projectName(project, projects) ?? 'Project'}</span>}{phase && <button className="phase-chip" onClick={() => openPhase(phase)} type="button">{phaseName(phase, phases) ?? 'Phase'}</button>}{item.isUnestimated && <span>unestimated</span>}{item.segmentCount && <span>part {item.segmentIndex}/{item.segmentCount}</span>}</div></div><div className="row-right"><strong>{hours(item.costHours)}</strong><button title="Pin today" className="pin" onClick={() => pin(task)} type="button">⌖</button>{item.state === 'late' ? <em className="late">late</em> : item.state === 'deferred' ? <em className="deferred">deferred</em> : item.state === 'unplannable' ? <em>unplannable</em> : null}</div></article>; };
  return <section className="day-list"><h3>Execution queue <span>{scheduled.length}</span></h3>{scheduled.length ? scheduled.map(row) : <p className="empty">No task fits this day.</p>}<details open={deferred.some((item) => item.state === 'late')}><summary>Pressure / displaced <span>{deferred.length}</span></summary>{deferred.map(row)}</details></section>;
}

function PhaseSheet({ phaseId, phases, tasks, close, reload }: { phaseId: string | null; phases: ApiRecord[]; tasks: ApiRecord<TaskFields>[]; close: () => void; reload: () => Promise<void> }) {
  if (!phaseId) return null;
  const phase = phases.find((item) => item.id === phaseId); const entries = tasks.filter((task) => task.fields.phase?.includes(phaseId));
  const toggle = async (task: ApiRecord<TaskFields>) => { await cadenceApi.update('Tasks', task.id, { status: task.fields.status === 'Terminé' ? 'Backlog' : 'Terminé', completedAt: task.fields.status === 'Terminé' ? undefined : today }); await reload(); };
  return <aside className="phase-sheet"><header><div><small>Cadence phase</small><h2>{text(phase?.fields.name)}</h2></div><button onClick={close} type="button">×</button></header><p>{entries.filter((task) => task.fields.status === 'Terminé').length}/{entries.length} tasks done · {hours(entries.reduce((sum, task) => sum + Math.max(0, Number(task.fields.estimatedHours ?? task.fields.legacyEstimateHours ?? 1) - Number(task.fields.loggedHours ?? 0)), 0))} left</p><div>{entries.map((task) => <label className="phase-task" key={task.id}><input type="checkbox" checked={task.fields.status === 'Terminé'} onChange={() => void toggle(task)} /><span>{task.fields.name}</span><small>{hours(Number(task.fields.estimatedHours ?? task.fields.legacyEstimateHours ?? 1))}</small></label>)}</div></aside>;
}

export default function App() {
  const [section, setSection] = useState<Section>('command');
  const [agentId, setAgentId] = useState<AgentId>('jarvis');
  const [modelId, setModelId] = useState<ModelId>('gpt-5.6-terra');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [run, setRun] = useState<Run>({ id: 'SYSTEM-READY', status: 'idle', message: 'Command interface online.', at: new Date().toLocaleTimeString() });
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'speaking' | 'error'>('idle');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('mute');
  const [clock, setClock] = useState(new Date());
  const [cadence, setCadence] = useState<CadenceState>({ loading: false, error: '', data: null });
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [showResources, setShowResources] = useState(false);
  const [lab, setLab] = useState<LabState>({ loading: false, error: '', data: null, output: '', running: false });
  const voiceRef = useRef<ReturnType<typeof createVoiceCapture> | null>(null); const recognitionRef = useRef<SpeechRecognitionLike | null>(null); const audioRef = useRef<HTMLAudioElement | null>(null); const liveVoiceRef = useRef(false); const voiceModeRef = useRef<VoiceMode>('mute'); const spaceDownRef = useRef(false); const suppressRestartRef = useRef(false); const lastFinalTranscriptRef = useRef(''); const submittingRef = useRef(false); const recognitionSessionRef = useRef(0);

  useEffect(() => { request<SystemStatus>('/api/status').then(setStatus).catch(() => undefined); const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { liveVoiceRef.current = shouldListenContinuously(voiceMode); voiceModeRef.current = voiceMode; }, [voiceMode]);
  useEffect(() => { const hotkey = getDictationHotkey(); const onKeyDown = (event: KeyboardEvent) => { if (event.code === hotkey.modifier) spaceDownRef.current = true; if (event.code === hotkey.code && spaceDownRef.current) { event.preventDefault(); if (voiceModeRef.current === 'mute') return; lastFinalTranscriptRef.current = ''; void startListening().catch((error) => { setVoiceState('error'); setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Manual dictation failed.' })); }); } }; const onKeyUp = (event: KeyboardEvent) => { if (event.code === hotkey.modifier) spaceDownRef.current = false; }; window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); }; }, []);
  useEffect(() => { if (section === 'cadence' && !cadence.data && !cadence.loading) void loadCadence(); }, [section]);
  useEffect(() => { if (section === 'lab' && !lab.data && !lab.loading) void loadLab(); }, [section]);

  const selectedAgent = useMemo(() => agents.find((item) => item.id === agentId)!, [agentId]);
  const responseText = run.output?.trim() || 'Perimeter is clear. Jarvis OS is online. Cadence is fused as the project manager.';
  const coreTone = getCoreTone({ listening: voiceState === 'listening', speaking: run.status === 'speaking' || voiceState === 'speaking' });
  const voiceLabel = voiceState === 'speaking' ? 'RESPONDING' : voiceState === 'listening' ? (voiceMode === 'live' ? 'LIVE / LISTENING' : 'LISTENING / TEXT') : voiceMode === 'live' ? 'LIVE' : voiceMode === 'listening' ? 'LISTENING' : 'MUTE';

  async function loadCadence() { setCadence((current) => ({ ...current, loading: true, error: '' })); try { setCadence({ loading: false, error: '', data: await cadenceApi.bootstrap() }); } catch (error) { setCadence((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Cadence link failed.' })); } }
  async function loadLab() { setLab((current) => ({ ...current, loading: true, error: '' })); try { const data = await request<HermesState>('/api/hermes/state'); setLab((current) => ({ ...current, loading: false, error: '', data })); } catch (error) { setLab((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Hermes Lab feed failed.' })); } }
  function releaseVoiceCapture() { voiceRef.current?.release(); voiceRef.current = null; }
  function stopRecognition({ suppressRestart = false } = {}) { suppressRestartRef.current = suppressRestart; const recognition = recognitionRef.current; if (recognition) { recognitionRef.current = null; recognition.stop(); } }
  async function speak(value: string) { const response = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: speechText(value) }) }); if (!response.ok) throw new Error('British voice output is unavailable.'); audioRef.current?.pause(); const url = URL.createObjectURL(await response.blob()); const audio = new Audio(url); audioRef.current = audio; audio.onended = () => URL.revokeObjectURL(url); await audio.play(); }
  async function startListening() { if (recognitionRef.current) return; const capture = createVoiceCapture({ getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), MediaRecorder }); voiceRef.current = capture; await capture.prepare(); const ctor = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition; if (!ctor) throw new Error('Live dictation requires Chrome speech recognition.'); const recognition = recognitionRef.current ?? new ctor(); recognitionRef.current = recognition; const sessionId = ++recognitionSessionRef.current; recognition.lang = 'en-GB'; recognition.interimResults = true; recognition.continuous = true; recognition.onresult = (event) => { if (recognitionSessionRef.current !== sessionId) return; const transcripts = Array.from(event.results).map((result) => result[0]?.transcript ?? ''); const joined = normalizeVoiceText(transcripts.join(' ')); if (joined) setPrompt(joined); const finalSegments = Array.from(event.results).filter((result) => result[0]?.isFinal).map((result) => result[0]?.transcript ?? ''); const finalTranscript = normalizeVoiceText(finalSegments.join(' ')); if (!finalTranscript || finalTranscript === lastFinalTranscriptRef.current) return; lastFinalTranscriptRef.current = finalTranscript; if (voiceModeRef.current === 'live') { const wake = parseWakeCommand(finalTranscript); if (!wake.activated) return; const command = wake.command || 'acknowledge'; setPrompt(command); void submitInstruction(command, true); return; } void submitInstruction(finalTranscript, true); }; recognition.onend = () => { if (recognitionSessionRef.current !== sessionId) return; releaseVoiceCapture(); recognitionRef.current = null; if (suppressRestartRef.current) { suppressRestartRef.current = false; return; } if (shouldKeepLiveVoiceArmed({ live: liveVoiceRef.current, cut: false })) { window.setTimeout(() => { void startListening().catch((error) => { setVoiceState('error'); setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Live voice restart failed.' })); }); }, 160); return; } setVoiceState('idle'); }; recognition.onerror = () => { if (recognitionSessionRef.current !== sessionId) return; releaseVoiceCapture(); recognitionRef.current = null; setVoiceState('error'); if (voiceModeRef.current !== 'live') setVoiceMode('mute'); }; recognition.start(); setVoiceState('listening'); }
  async function setVoiceInteractionMode(nextMode: VoiceMode) { setVoiceMode(nextMode); voiceModeRef.current = nextMode; liveVoiceRef.current = shouldListenContinuously(nextMode); lastFinalTranscriptRef.current = ''; if (nextMode === 'mute') { stopRecognition({ suppressRestart: true }); audioRef.current?.pause(); audioRef.current = null; releaseVoiceCapture(); setVoiceState('idle'); setRun((current) => ({ ...current, message: 'Voice muted. Jarvis will not listen or speak.' })); return; } try { await startListening(); setRun((current) => ({ ...current, message: nextMode === 'live' ? 'Live mode armed. Jarvis will listen and speak back.' : 'Listening mode armed. Jarvis will answer in text only.' })); } catch (error) { liveVoiceRef.current = false; voiceModeRef.current = 'mute'; setVoiceMode('mute'); releaseVoiceCapture(); setVoiceState('error'); setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Voice unavailable.' })); } }
  async function toggleVoice() { await setVoiceInteractionMode(voiceModeRef.current === 'live' ? 'mute' : 'live'); }
  async function submitInstruction(instruction: string, fromVoice = false) { const trimmed = normalizeVoiceText(instruction); if (!trimmed || submittingRef.current) return; submittingRef.current = true; const currentRunId = `RUN-${Date.now().toString(36).toUpperCase()}`; setRun({ id: currentRunId, status: 'planning', message: 'Validating request boundary…', at: new Date().toLocaleTimeString() }); try { setRun((current) => ({ ...current, status: 'running', message: `Dispatching ${selectedAgent.label} through Hermes…` })); if (fromVoice || liveVoiceRef.current) stopRecognition({ suppressRestart: true }); const result = await request<{ id: string; output: string }>('/api/run', { method: 'POST', body: JSON.stringify({ agentId, modelId, prompt: trimmed }) }); setPrompt(trimmed); if (shouldSpeakResponse(voiceModeRef.current)) { setRun({ id: result.id, status: 'speaking', message: 'Response received. Speaking back…', output: result.output, at: new Date().toLocaleTimeString() }); setVoiceState('speaking'); await speak(result.output); } setRun({ id: result.id, status: 'done', message: shouldSpeakResponse(voiceModeRef.current) ? 'Verified response received.' : 'Text response received. Voice output muted.', output: result.output, at: new Date().toLocaleTimeString() }); setVoiceState(liveVoiceRef.current ? 'listening' : 'idle'); if (liveVoiceRef.current) await startListening(); } catch (error) { setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Dispatch failed.', at: new Date().toLocaleTimeString() })); if (liveVoiceRef.current) { liveVoiceRef.current = false; voiceModeRef.current = 'mute'; setVoiceMode('mute'); } setVoiceState('error'); } finally { submittingRef.current = false; } }
  async function send() { await submitInstruction(prompt, false); }

  return <main className={`shell jarvis-os ${voiceMode === 'live' ? 'voice-live' : voiceMode === 'listening' ? 'voice-listening-mode' : 'voice-muted'} ${coreTone === 'listening' ? 'voice-listening' : ''}`}><div className="scanlines" aria-hidden="true" /><header className="topbar os-topbar"><div className="brand-lockup"><div className="brand-mark">◊</div><div><div className="brand-title">JARVIS OS</div><div className="brand-subtitle">FUSED COMMAND SURFACE — OPEN OPERATOR MODE</div></div></div><nav className="section-tabs" aria-label="Jarvis OS sections">{nav.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)} type="button">{item.label}</button>)}</nav><div className="clock-stack"><strong>{clock.toLocaleTimeString('en-GB', { hour12: false })}</strong><span>{section.toUpperCase()} • ORACLE ACTIVE</span></div></header>{section === 'command' && renderCommand()}{section === 'cadence' && renderCadence()}{section === 'lab' && renderLab()}<footer className="footer-bar"><span>JARVIS OS • COMMAND / CADENCE / LAB</span><span>GRID LOCKED • {status?.profiles.length ?? 0} PROFILES • AUTH DISABLED</span></footer></main>;

  function renderCommand() { const statusRows = [{ label: 'Jarvis Gateway', value: 96 }, { label: 'Cadence Link', value: cadence.data ? 96 : 76 }, { label: 'Voice Uplink', value: voiceMode === 'mute' ? 36 : 88 }, { label: 'Lab Graph', value: lab.data ? 96 : 54 }]; return <section className="dashboard command-dashboard"><aside className="status-rail panel"><p className="eyebrow">SYSTEM STATUS</p><div className="status-list">{statusRows.map((row) => <div key={row.label} className="status-row"><div className="status-row-head"><span>{row.label}</span><strong>{row.value}%</strong></div><div className="status-bar"><i style={{ width: `${row.value}%` }} /></div></div>)}</div><div className="rail-filler" /></aside><main className="mission-stack"><section className="perimeter panel"><div className="panel-head"><p className="eyebrow">COMMAND CORE</p><span className={`active-tag ${run.status === 'error' ? 'error' : 'ok'}`}>{run.status === 'error' ? 'ALERT' : 'ACTIVE'}</span></div><ParticleSphere tone={coreTone} /><div className="panel-foot"><span>ACTIVE SECTION: {section.toUpperCase()}</span><span>CONFIDENCE: 96%</span></div></section>{renderVoiceStrip()}<section className="response-panel panel"><p className="eyebrow">JARVIS — TEXT RESPONSE</p><div className="response-line"><p className="response-text">{responseText}</p><span className="response-cursor">▌</span></div>{renderCommandRow()}</section></main><aside className="blueprint-rail"><div className="blueprint-spacer" /><section className="blueprint panel"><div className="blueprint-head"><span className="eyebrow">SYSTEM BLUEPRINT</span><span className="class-tag">FUSION</span></div><div className="blueprint-body" aria-hidden="true"><svg viewBox="0 0 120 120" className="blueprint-svg"><polygon points="60,8 108,42 90,110 30,110 12,42" fill="none" stroke="rgba(232,232,232,0.42)" strokeWidth="1" /><polygon points="60,30 86,50 76,96 44,96 34,50" fill="none" stroke="#d9564c" strokeWidth="1" strokeDasharray="2 3" /><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(232,232,232,0.14)" strokeWidth="1" /></svg></div><div className="blueprint-label">OS</div></section></aside></section>; }
  function renderVoiceStrip() { return <section className="voice-strip panel"><div className="voice-uplink"><div className="voice-copy"><span className="eyebrow">VOICE UPLINK</span><div className="voice-wave" aria-hidden="true">{voiceBars.map((height, index) => <i key={`${height}-${index}`} style={{ height: `${height}px`, animationDelay: `${index * 0.05}s` }} />)}</div></div></div><div className="voice-mode-control"><span className={`voice-state ${voiceMode === 'live' ? 'armed' : voiceMode} ${voiceState}`}>{voiceLabel}</span><select className="voice-mode-select" value={voiceMode} onChange={(event) => { void setVoiceInteractionMode(event.target.value as VoiceMode); }} aria-label="Voice interaction mode"><option value="mute">MUTE</option><option value="listening">LISTENING</option><option value="live">LIVE</option></select></div></section>; }
  function renderCommandRow() { return <div className="command-row"><button className={`voice ${voiceMode === 'live' ? 'armed' : 'muted'} ${voiceState}`} onClick={toggleVoice} aria-label="Toggle live or mute voice mode" type="button">{voiceMode === 'live' ? 'MUTE' : 'LIVE'}</button><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} placeholder="Issue a command to Jarvis…" /><button className="send" onClick={send} disabled={!prompt.trim() || run.status === 'running' || run.status === 'speaking'} type="button">EXECUTE ↗</button></div>; }

  function cadencePlan() { const data = cadence.data; if (!data) return null; const template = Object.fromEntries(data['Capacity Template'].map((row) => [Number(row.fields.index), Number(row.fields.hours ?? 0)])); const settings = Object.fromEntries(data.Settings.map((row) => [String(row.fields.key), Number(row.fields.value)])); const capacity = Object.fromEntries(data['Day Capacity'].map((row) => [String(row.fields.day ?? row.fields.key), Number(row.fields.hours)])); const tasks: PlanTask[] = data.Tasks.map((task) => ({ id: task.id, name: String(task.fields.name ?? ''), status: String(task.fields.status ?? ''), priority: (task.fields.priority ?? 'P2') as PlanTask['priority'], estimatedHours: Number(task.fields.estimatedHours ?? task.fields.legacyEstimateHours ?? 0), loggedHours: Number(task.fields.loggedHours ?? 0), pinnedDay: task.fields.pinnedDay, dueDate: task.fields.dueDate, createdAt: task.createdTime, displayOrder: Number(task.fields.displayOrder ?? 0), capacityExempt: Boolean(task.fields.capacityExempt), isGroup: Boolean(task.fields.children?.length) })); const plan = buildPlan(tasks, capacity, Array.from({ length: 7 }, (_, index) => template[index] ?? (index === 0 || index === 6 ? 0 : 8)), { defaultDayHours: settings.default_day_hours || 8, defaultTaskHours: settings.default_task_hours || 1, spillHorizonDays: settings.spill_horizon_days || 90 }, today); return { data, template, capacity, plan, current: plan[0] }; }
  async function setCapacity(day: string, value: number) { const model = cadencePlan(); if (!model || !cadence.data) return; const existing = cadence.data['Day Capacity'].find((row) => String(row.fields.day ?? row.fields.key) === day); const next = { ...cadence.data, 'Day Capacity': existing ? cadence.data['Day Capacity'].map((row) => row.id === existing.id ? { ...row, fields: { ...row.fields, hours: value } } : row) : [...cadence.data['Day Capacity'], { id: `optimistic-${day}`, fields: { key: day, day, hours: value } }] }; setCadence({ loading: false, error: '', data: next }); const templateValue = model.template[new Date(`${day}T12:00:00Z`).getDay()] ?? 8; try { if (value === templateValue && existing) await cadenceApi.remove('Day Capacity', existing.id); else await cadenceApi.upsert('Day Capacity', [{ fields: { key: day, day, hours: value } }], ['key']); await loadCadence(); } catch (error) { setCadence((current) => ({ ...current, error: error instanceof Error ? error.message : 'Capacity update failed.' })); } }
  async function pin(task: ApiRecord<TaskFields>) { await cadenceApi.update('Tasks', task.id, { pinnedDay: today }); await loadCadence(); }
  function openPhase(id: string) { setPhaseId(id); }
  function closePhase() { setPhaseId(null); }

  function renderCadence() {
    const model = cadencePlan();
    if (!model) return <section className="cadence-screen os-screen"><div className="screen-head"><div><p className="eyebrow">CADENCE SYSTEM</p><h1>Task manager loading.</h1><span>Pulling Airtable execution model: tasks, phases, capacity, settings.</span></div><button className="refresh-button" onClick={() => void loadCadence()} type="button">SYNC CADENCE ↻</button></div>{cadence.error && <div className="alert-line">CADENCE LINK ERROR — {cadence.error}</div>}</section>;
    return <ProductivitySection model={model} error={cadence.error} today={today} onReload={loadCadence} onSetCapacity={setCapacity} onPinTask={pin} />;
  }

  async function dispatchLabAgent(profile: HermesProfile) {
    if (!prompt.trim()) { setLab((current) => ({ ...current, output: 'Enter a command in the command input first.' })); return; }
    if (!agents.some((agent) => agent.id === profile.id)) { setLab((current) => ({ ...current, output: `${profile.name} is visible but not dispatch-allowlisted yet.` })); return; }
    setAgentId(profile.id as AgentId);
    setLab((current) => ({ ...current, running: true, output: `Dispatching ${profile.name} through Hermes…` }));
    try {
      const result = await request<{ id: string; output: string }>('/api/hermes/dispatch', { method: 'POST', body: JSON.stringify({ agentId: profile.id, modelId, prompt: prompt.trim() }) });
      setLab((current) => ({ ...current, running: false, output: `${result.id}\n\n${result.output}` }));
      setRun({ id: result.id, status: 'done', message: `Lab dispatch complete: ${profile.name}`, output: result.output, at: new Date().toLocaleTimeString() });
    } catch (error) {
      setLab((current) => ({ ...current, running: false, output: error instanceof Error ? error.message : 'Lab dispatch failed.' }));
    }
  }

  function renderLab() {
    const profiles = lab.data?.profiles ?? [];
    return <section className="lab-screen os-screen live-lab"><div className="screen-head"><div><p className="eyebrow">THE LAB</p><h1>Hermes agent network.</h1><span>Live VPS profiles, models, gateways and installed skills. Not Airtable. Not simulated.</span></div><button className="refresh-button" onClick={() => void loadLab()} type="button">SYNC HERMES ↻</button></div>{lab.error && <div className="alert-line">HERMES LAB ERROR — {lab.error}</div>}<div className="lab-grid hermes-lab-grid"><section className="panel graph-panel"><div className="panel-head"><p className="eyebrow">LOCAL VPS TOPOLOGY</p><span className="active-tag ok">{profiles.length || '—'} PROFILES</span></div><div className="agent-graph hermes-live-graph molecule-shell"><HermesMoleculeLayer profiles={profiles} selectedId={agentId} onSelect={(profile) => { if (agents.some((candidate) => candidate.id === profile.id)) setAgentId(profile.id as AgentId); }} /><div className="graph-core molecule-core">JARVIS<br /><small>MOLECULE LIVE</small></div></div></section><section className="panel list-panel hermes-agent-panel"><div className="panel-head"><p className="eyebrow">HERMES PROFILES</p><span className="class-tag">{profiles.filter((item) => item.gateway === 'running').length} RUNNING</span></div><div className="record-list hermes-profile-list">{profiles.map((profile) => <article key={profile.id} className={profile.id === agentId ? 'selected-profile' : ''}><div><strong>{profile.name}</strong><span>{profile.role}</span><span>{profile.provider} / {profile.model}</span><span>{profile.skills} skills · gateway {profile.gateway}</span></div><button type="button" disabled={lab.running || !agents.some((agent) => agent.id === profile.id)} onClick={() => void dispatchLabAgent(profile)}>{agents.some((agent) => agent.id === profile.id) ? 'RUN ↗' : 'VIEW'}</button></article>)}</div></section><section className="panel list-panel hermes-ops-panel"><div className="panel-head"><p className="eyebrow">LIVE OPERATIONS</p><span className="class-tag">E2E</span></div><div className="lab-command-copy"><strong>Command input is shared with COMMAND.</strong><span>Type a prompt in the main command field, pick an agent here, hit RUN. Backend invokes the real Hermes CLI on this VPS.</span></div><div className="ops-log">{lab.output || 'No lab dispatch yet.'}</div><div className="panel-head compact"><p className="eyebrow">SKILLS SAMPLE</p><span className="class-tag">{selectedAgent.label}</span></div><div className="skill-chip-grid">{profiles.find((profile) => profile.id === agentId)?.skillNames?.map((skill) => <span key={skill}>{skill}</span>) ?? <span>Select an agent.</span>}</div></section></div></section>;
  }
}
