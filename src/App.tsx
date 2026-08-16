import React, { useEffect, useMemo, useRef, useState } from 'react';
import { agents, models, type AgentId, type ModelId } from './lib/commandContract';
import { createVoiceCapture } from './lib/voiceCapture';
import { getCoreTone, getDictationHotkey, normalizeVoiceText, parseWakeCommand, shouldKeepLiveVoiceArmed, shouldListenContinuously, shouldSpeakResponse, type VoiceMode } from './lib/liveVoice';
import { speechText } from './lib/speech';
import ParticleSphere from './components/ParticleSphere';
import './styles.css';

type SpeechRecognitionWord = { transcript: string; isFinal?: boolean };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionWord>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type Run = { id: string; status: 'idle' | 'planning' | 'running' | 'speaking' | 'done' | 'error'; message: string; output?: string; at: string };
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
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'speaking' | 'error'>('idle');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('mute');
  const [clock, setClock] = useState(new Date());
  const voiceRef = useRef<ReturnType<typeof createVoiceCapture> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveVoiceRef = useRef(false);
  const voiceModeRef = useRef<VoiceMode>('mute');
  const spaceDownRef = useRef(false);
  const suppressRestartRef = useRef(false);
  const lastFinalTranscriptRef = useRef('');
  const submittingRef = useRef(false);
  const recognitionSessionRef = useRef(0);

  useEffect(() => {
    request<SystemStatus>('/api/status').then((value) => { setStatus(value); setAuthenticated(true); }).catch(() => undefined);
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    liveVoiceRef.current = shouldListenContinuously(voiceMode);
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    const hotkey = getDictationHotkey();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === hotkey.modifier) spaceDownRef.current = true;
      if (event.code === hotkey.code && spaceDownRef.current) {
        event.preventDefault();
        if (voiceModeRef.current === 'mute') return;
        lastFinalTranscriptRef.current = '';
        void startListening().catch((error) => {
          setVoiceState('error');
          setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Manual dictation failed.' }));
        });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === hotkey.modifier) spaceDownRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const selectedAgent = useMemo(() => agents.find((item) => item.id === agentId)!, [agentId]);
  const selectedModel = useMemo(() => models.find((item) => item.id === modelId)!, [modelId]);
  const statusRows = [
    { label: 'Power Core', value: 94 },
    { label: 'Network Uplink', value: 78 },
    { label: 'Sensor Array', value: 88 },
    { label: 'Drone Fleet', value: 61 },
  ];
  const voiceBars = [6, 14, 9, 18, 11, 16, 8, 15, 10, 17, 7, 13, 9, 12];
  const responseText = run.output?.trim() || 'Perimeter is clear. Recon-2 reports sector 7 secure and convoy on schedule.';
  const coreTone = getCoreTone({ listening: voiceState === 'listening', speaking: run.status === 'speaking' || voiceState === 'speaking' });
  const voiceLabel = voiceState === 'speaking'
    ? 'RESPONDING'
    : voiceState === 'listening'
      ? (voiceMode === 'live' ? 'LIVE / LISTENING' : 'LISTENING / TEXT')
      : voiceMode === 'live'
        ? 'LIVE'
        : voiceMode === 'listening'
          ? 'LISTENING'
          : 'MUTE';

  function releaseVoiceCapture() {
    voiceRef.current?.release();
    voiceRef.current = null;
  }

  function stopRecognition({ suppressRestart = false } = {}) {
    suppressRestartRef.current = suppressRestart;
    const recognition = recognitionRef.current;
    if (recognition) {
      recognitionRef.current = null;
      recognition.stop();
    }
  }

  async function speak(value: string) {
    const response = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: speechText(value) }) });
    if (!response.ok) throw new Error('British voice output is unavailable.');
    audioRef.current?.pause();
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  async function startListening() {
    if (recognitionRef.current) return;
    const capture = createVoiceCapture({ getUserMedia: navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), MediaRecorder });
    voiceRef.current = capture;
    await capture.prepare();
    const ctor = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!ctor) throw new Error('Live dictation requires Chrome speech recognition.');

    const recognition = recognitionRef.current ?? new ctor();
    recognitionRef.current = recognition;
    const sessionId = ++recognitionSessionRef.current;
    recognition.lang = 'en-GB';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      if (recognitionSessionRef.current !== sessionId) return;
      const transcripts = Array.from(event.results).map((result) => result[0]?.transcript ?? '');
      const joined = normalizeVoiceText(transcripts.join(' '));
      if (joined) setPrompt(joined);
      const finalSegments = Array.from(event.results).filter((result) => result[0]?.isFinal).map((result) => result[0]?.transcript ?? '');
      const finalTranscript = normalizeVoiceText(finalSegments.join(' '));
      if (!finalTranscript || finalTranscript === lastFinalTranscriptRef.current) return;
      lastFinalTranscriptRef.current = finalTranscript;
      if (voiceModeRef.current === 'live') {
        const wake = parseWakeCommand(finalTranscript);
        if (!wake.activated) return;
        const command = wake.command || 'acknowledge';
        setPrompt(command);
        void submitInstruction(command, true);
        return;
      }
      void submitInstruction(finalTranscript, true);
    };
    recognition.onend = () => {
      if (recognitionSessionRef.current !== sessionId) return;
      releaseVoiceCapture();
      recognitionRef.current = null;
      if (suppressRestartRef.current) {
        suppressRestartRef.current = false;
        return;
      }
      if (shouldKeepLiveVoiceArmed({ live: liveVoiceRef.current, cut: false })) {
        window.setTimeout(() => {
          void startListening().catch((error) => {
            setVoiceState('error');
            setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Live voice restart failed.' }));
          });
        }, 160);
        return;
      }
      setVoiceState('idle');
    };
    recognition.onerror = () => {
      if (recognitionSessionRef.current !== sessionId) return;
      releaseVoiceCapture();
      recognitionRef.current = null;
      setVoiceState('error');
      if (voiceModeRef.current !== 'live') setVoiceMode('mute');
    };
    recognition.start();
    setVoiceState('listening');
  }

  async function setVoiceInteractionMode(nextMode: VoiceMode) {
    setVoiceMode(nextMode);
    voiceModeRef.current = nextMode;
    liveVoiceRef.current = shouldListenContinuously(nextMode);
    lastFinalTranscriptRef.current = '';

    if (nextMode === 'mute') {
      stopRecognition({ suppressRestart: true });
      audioRef.current?.pause();
      audioRef.current = null;
      releaseVoiceCapture();
      setVoiceState('idle');
      setRun((current) => ({ ...current, message: 'Voice muted. Jarvis will not listen or speak.' }));
      return;
    }

    try {
      await startListening();
      setRun((current) => ({ ...current, message: nextMode === 'live' ? 'Live mode armed. Jarvis will listen and speak back.' : 'Listening mode armed. Jarvis will answer in text only.' }));
    } catch (error) {
      liveVoiceRef.current = false;
      voiceModeRef.current = 'mute';
      setVoiceMode('mute');
      releaseVoiceCapture();
      setVoiceState('error');
      setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Voice unavailable.' }));
    }
  }

  async function toggleVoice() {
    await setVoiceInteractionMode(voiceModeRef.current === 'live' ? 'mute' : 'live');
  }

  async function submitInstruction(instruction: string, fromVoice = false) {
    const trimmed = normalizeVoiceText(instruction);
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    const currentRunId = `RUN-${Date.now().toString(36).toUpperCase()}`;
    setRun({ id: currentRunId, status: 'planning', message: 'Validating request boundary…', at: new Date().toLocaleTimeString() });
    try {
      setRun((current) => ({ ...current, status: 'running', message: `Dispatching ${selectedAgent.label} through Hermes…` }));
      if (fromVoice || liveVoiceRef.current) stopRecognition({ suppressRestart: true });
      const result = await request<{ id: string; output: string }>('/api/run', { method: 'POST', body: JSON.stringify({ agentId, modelId, prompt: trimmed }) });
      setPrompt(trimmed);
      if (shouldSpeakResponse(voiceModeRef.current)) {
        setRun({ id: result.id, status: 'speaking', message: 'Response received. Speaking back…', output: result.output, at: new Date().toLocaleTimeString() });
        setVoiceState('speaking');
        await speak(result.output);
      }
      setRun({ id: result.id, status: 'done', message: shouldSpeakResponse(voiceModeRef.current) ? 'Verified response received.' : 'Text response received. Voice output muted.', output: result.output, at: new Date().toLocaleTimeString() });
      setVoiceState(liveVoiceRef.current ? 'listening' : 'idle');
      if (liveVoiceRef.current) {
        await startListening();
      }
    } catch (error) {
      setRun((current) => ({ ...current, status: 'error', message: error instanceof Error ? error.message : 'Dispatch failed.', at: new Date().toLocaleTimeString() }));
      if (liveVoiceRef.current) {
        liveVoiceRef.current = false;
        voiceModeRef.current = 'mute';
        setVoiceMode('mute');
      }
      setVoiceState('error');
    } finally {
      submittingRef.current = false;
    }
  }

  async function send() {
    await submitInstruction(prompt, false);
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginError('');
    try {
      await request('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
      const system = await request<SystemStatus>('/api/status');
      setStatus(system);
      setAuthenticated(true);
      setPassword('');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Access denied.');
    }
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <div className="scanlines" />
        <form className="login panel" onSubmit={login}>
          <span className="brand-mark">◈</span>
          <p className="eyebrow">PRIVATE OPERATOR CONSOLE</p>
          <h1>JARVIS</h1>
          <p>Authenticate to establish a secure local broker link.</p>
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Access password" />
          <button type="submit">ESTABLISH LINK ↗</button>
          {loginError && <small className="login-error">{loginError}</small>}
          <small>Credentials remain server-side. Session expires automatically.</small>
        </form>
      </main>
    );
  }

  return (
    <main className={`shell ${voiceMode === 'live' ? 'voice-live' : voiceMode === 'listening' ? 'voice-listening-mode' : 'voice-muted'} ${coreTone === 'listening' ? 'voice-listening' : ''}`}>
      <div className="scanlines" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">◊</div>
          <div>
            <div className="brand-title">JARVIS</div>
            <div className="brand-subtitle">COMMAND INTERFACE — CLEARANCE 4</div>
          </div>
        </div>
        <button className="overview-chip" type="button">OVERVIEW</button>
        <div className="clock-stack">
          <strong>{clock.toLocaleTimeString('en-GB', { hour12: false })}</strong>
          <span>{clock.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        </div>
      </header>

      <section className="dashboard">
        <aside className="status-rail panel">
          <p className="eyebrow">SYSTEM STATUS</p>
          <div className="status-list">
            {statusRows.map((row) => (
              <div key={row.label} className="status-row">
                <div className="status-row-head">
                  <span>{row.label}</span>
                  <strong>{row.value}%</strong>
                </div>
                <div className="status-bar"><i style={{ width: `${row.value}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="rail-filler" />
        </aside>

        <main className="mission-stack">
          <section className="perimeter panel">
            <div className="panel-head">
              <p className="eyebrow">PERIMETER SCAN</p>
              <span className={`active-tag ${run.status === 'error' ? 'error' : 'ok'}`}>{run.status === 'error' ? 'ALERT' : 'ACTIVE'}</span>
            </div>
            <ParticleSphere tone={coreTone} />
            <div className="panel-foot">
              <span>OBJECTS TRACKED: 042</span>
              <span>CONFIDENCE: 96%</span>
            </div>
          </section>

          <section className="voice-strip panel">
            <div className="voice-uplink">
              <div className="voice-copy">
                <span className="eyebrow">VOICE UPLINK</span>
                <div className="voice-wave" aria-hidden="true">
                  {voiceBars.map((height, index) => (
                    <i key={`${height}-${index}`} style={{ height: `${height}px`, animationDelay: `${index * 0.05}s` }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="voice-mode-control">
              <span className={`voice-state ${voiceMode === 'live' ? 'armed' : voiceMode} ${voiceState}`}>{voiceLabel}</span>
              <select
                className="voice-mode-select"
                value={voiceMode}
                onChange={(event) => { void setVoiceInteractionMode(event.target.value as VoiceMode); }}
                aria-label="Voice interaction mode"
              >
                <option value="mute">MUTE</option>
                <option value="listening">LISTENING</option>
                <option value="live">LIVE</option>
              </select>
            </div>
          </section>

          <section className="response-panel panel">
            <p className="eyebrow">JARVIS — TEXT RESPONSE</p>
            <div className="response-line">
              <p className="response-text">{responseText}</p>
              <span className="response-cursor">▌</span>
            </div>
            <div className="command-row">
              <button className={`voice ${voiceMode === 'live' ? 'armed' : 'muted'} ${voiceState}`} onClick={toggleVoice} aria-label="Toggle live or mute voice mode" type="button">
                {voiceMode === 'live' ? 'MUTE' : 'LIVE'}
              </button>
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && send()}
                placeholder="Issue a command to the perimeter…"
              />
              <button className="send" onClick={send} disabled={!prompt.trim() || run.status === 'running' || run.status === 'speaking'} type="button">EXECUTE ↗</button>
            </div>
          </section>
        </main>

        <aside className="blueprint-rail">
          <div className="blueprint-spacer" />
          <section className="blueprint panel">
            <div className="blueprint-head">
              <span className="eyebrow">ASSET BLUEPRINT</span>
              <span className="class-tag">CLASS: TX-114</span>
            </div>
            <div className="blueprint-body" aria-hidden="true">
              <svg viewBox="0 0 120 120" className="blueprint-svg" aria-hidden="true">
                <polygon points="60,8 108,42 90,110 30,110 12,42" fill="none" stroke="rgba(232,232,232,0.42)" strokeWidth="1" />
                <polygon points="60,30 86,50 76,96 44,96 34,50" fill="none" stroke="#d9564c" strokeWidth="1" strokeDasharray="2 3" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(232,232,232,0.14)" strokeWidth="1" />
              </svg>
            </div>
            <div className="blueprint-label">TANK</div>
          </section>
        </aside>
      </section>

      <footer className="footer-bar">
        <span>OPERATION NIGHTWATCH • AUTHORIZATION LEVEL 4</span>
        <span>GRID LOCKED • {status?.profiles.length ?? 0} PROFILES • {status?.tools.length ?? 0} TOOLS</span>
      </footer>
    </main>
  );
}
