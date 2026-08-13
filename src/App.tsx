import React, { useEffect, useMemo, useRef, useState } from 'react';
import { agents, models, type AgentId, type ModelId } from './lib/commandContract';
import { createVoiceCapture } from './lib/voiceCapture';
import { speechText } from './lib/speech';
import './styles.css';

type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type Run = { id: string; status: 'idle' | 'planning' | 'running' | 'done' | 'error'; message: string; output?: string; at: string };
type SystemStatus = { profiles: Array<{ id: string; model: string; gateway: string }>; tools: string[]; now: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) throw new Error((await response.json().catch(() => ({ error: 'Request failed' }))).error ?? 'Request failed');
  return response.json() as Promise<T>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [agentId, setAgentId] = useState<AgentId>('jarvis');
  const [modelId, setModelId] = useState<ModelId>('gpt-5.6-terra');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [run, setRun] = useState<Run>({ id: 'SYSTEM-READY', status: 'idle', message: 'Command interface online.', at: new Date().toLocaleTimeString() });
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'error'>('idle');
  const [clock, setClock] = useState(new Date());
  const voiceRef = useRef<ReturnType<typeof createVoiceCapture> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    request<SystemStatus>('/api/status').then((value) => { setStatus(value); setAuthenticated(true); }).catch(() => undefined);
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedAgent = useMemo(() => agents.find((item) => item.id === agentId)!, [agentId]);
  const selectedModel = useMemo(() => models.find((item) => item.id === modelId)!, [modelId]);

  async function speak(value: string) {
    const response = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: speechText(value) }) });
    if (!response.ok) throw new Error('British voice output is unavailable.');
    audioRef.current?.pause();
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url); audioRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  async function send() {
    const instruction = prompt.trim();
    if (!instruction || run.status === 'running') return;
    setRun({ id: `RUN-${Date.now().toString(36).toUpperCase()}`, status: 'planning', message: 'Validating request boundary…', at: new Date().toLocaleTimeString() });
    try {
      setRun((current) => ({ ...current, status: 'running', message: `Dispatching ${selectedAgent.label} through Hermes…` }));
      const result = await request<{ id: string; output: string }>('/api/run', { method: 'POST', body: JSON.stringify({ agentId, modelId, prompt: instruction }) });
      setRun({ id: result.id, status: 'done', message: 'Verified response received.', output: result.output, at: new Date().toLocaleTimeString() });
      void speak(result.output).catch(() => undefined);
      setPrompt('');
    } catch (error) {
      setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Dispatch failed.', at: new Date().toLocaleTimeString() }));
    }
  }

  async function toggleVoice() {
    if (voiceState === 'listening') { recognitionRef.current?.stop(); voiceRef.current?.release(); setVoiceState('idle'); return; }
    const capture = createVoiceCapture({ getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), MediaRecorder });
    voiceRef.current = capture;
    try {
      await capture.prepare();
      const ctor = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
      if (!ctor) throw new Error('Live dictation requires Chrome speech recognition.');
      const recognition = new ctor(); recognitionRef.current = recognition;
      recognition.lang = 'en-GB'; recognition.interimResults = true; recognition.continuous = false;
      recognition.onresult = (event) => setPrompt(Array.from(event.results).map((result) => result[0]?.transcript ?? '').join('').trim());
      recognition.onend = () => { voiceRef.current?.release(); recognitionRef.current = null; setVoiceState('idle'); };
      recognition.onerror = () => { voiceRef.current?.release(); setVoiceState('error'); };
      recognition.start(); setVoiceState('listening');
    } catch (error) { voiceRef.current?.release(); setVoiceState('error'); setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Voice unavailable.' })); }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginError('');
    try { await request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); const system = await request<SystemStatus>('/api/status'); setStatus(system); setAuthenticated(true); setPassword(''); }
    catch (error) { setLoginError(error instanceof Error ? error.message : 'Access denied.'); }
  }

  if (!authenticated) return <main className="login-shell"><div className="scanlines" /><form className="login panel" onSubmit={login}><span className="brand-mark">◈</span><p className="eyebrow">PRIVATE OPERATOR CONSOLE</p><h1>JARVIS</h1><p>Authenticate to establish a secure local broker link.</p><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Access password" /><button type="submit">ESTABLISH LINK ↗</button>{loginError && <small className="login-error">{loginError}</small>}<small>Credentials remain server-side. Session expires automatically.</small></form></main>;

  return <main className="shell">
    <div className="scanlines" aria-hidden="true" />
    <header className="topbar">
      <div className="brand"><span className="brand-mark">◈</span><span>JARVIS // PRIVATE OPERATOR CONSOLE</span></div>
      <div className="system-pills"><span className="pulse" />SECURE LINK <span>UTC {clock.toISOString().slice(11, 19)}</span></div>
    </header>
    <section className="dashboard">
      <aside className="left-rail panel">
        <p className="eyebrow">AGENT MESH / 07</p>
        <div className="agent-list">{agents.map((agent) => <button key={agent.id} className={`agent ${agent.id === agentId ? 'selected' : ''}`} onClick={() => setAgentId(agent.id)}><span className={`agent-dot ${agent.accent}`} /><span><b>{agent.label}</b><small>{agent.role}</small></span><em>{agent.id === agentId ? 'LINKED' : 'READY'}</em></button>)}</div>
        <div className="telemetry"><p className="eyebrow">SYSTEM TELEMETRY</p>{['TOOLS / AUTHORIZED','MEMORY / PERSISTENT','CHANNEL / TELEGRAM','EXTERNAL WRITES / APPROVAL'].map((item, index) => <div className="meter" key={item}><span>{item}</span><i><b style={{ width: `${88 - index * 11}%` }} /></i></div>)}</div>
      </aside>
      <section className="core">
        <div className="core-meta"><span>ACTIVE PROFILE: <b>{selectedAgent.label}</b></span><span>MODEL: <b>{selectedModel.label}</b></span></div>
        <div className={`orbital ${run.status}`}>
          <div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit orbit-c" />
          <div className="ticks">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 11.25}deg)` }} />)}</div>
          <div className="signal-cloud">{Array.from({ length: 96 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 90 - 45}px`, '--y': `${(i * 61) % 88 - 44}px`, '--d': `${0.8 + (i % 7) / 10}s` } as React.CSSProperties} />)}</div>
          <div className="core-label"><strong>{run.status === 'running' ? 'PROCESSING' : selectedAgent.label}</strong><span>{run.status === 'done' ? 'RUN COMPLETE' : voiceState === 'listening' ? 'VOICE LINK OPEN' : 'AWAITING COMMAND'}</span></div>
        </div>
        <div className="command-deck panel">
          <div className="deck-header"><span>COMMAND / {run.id}</span><span className={`state ${run.status}`}>{run.status}</span></div>
          <p>{run.message}</p>
          {run.output && <pre>{run.output}</pre>}
          <div className="input-row"><button className={`voice ${voiceState}`} onClick={toggleVoice} aria-label="Toggle voice capture">◉</button><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} placeholder="Issue a command to your agent…" /><button className="send" onClick={send} disabled={!prompt.trim() || run.status === 'running'}>EXECUTE ↗</button></div>
          <small className="privacy">Browser requests are brokered locally. Existing credentials never enter this interface.</small>
        </div>
      </section>
      <aside className="right-rail">
        <div className="panel chronometer"><p className="eyebrow">MISSION CLOCK</p><strong>{clock.toLocaleTimeString('en-GB', { hour12: false })}</strong><span>{clock.toISOString().slice(0, 10)} // VPS UTC</span></div>
        <div className="panel radar"><p className="eyebrow">AGENT SIGNAL MAP</p><div className="radar-grid"><i /><i /><i /><b /></div><span>NETWORK STABLE // {status?.profiles.length ?? 0} PROFILES</span></div>
        <div className="panel model-panel"><p className="eyebrow">INFERENCE CORE</p><label>ACTIVE MODEL<select value={modelId} onChange={(event) => setModelId(event.target.value as ModelId)}>{models.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.vendor}</option>)}</select></label><small>Selection is allowlisted server-side. It does not alter your global Hermes profile configuration.</small></div>
        <div className="panel integrations"><p className="eyebrow">CONNECTED CAPABILITIES</p>{(status?.tools ?? ['Airtable','Notion','GitHub','Browser','Telegram']).map((tool) => <span key={tool}><b>+</b>{tool}</span>)}</div>
      </aside>
    </section>
  </main>;
}
