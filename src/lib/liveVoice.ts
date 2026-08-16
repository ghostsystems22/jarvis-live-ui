export type VoiceMode = 'mute' | 'listening' | 'live';
export type CoreTone = 'idle' | 'listening' | 'speaking';

export function shouldKeepLiveVoiceArmed(input: { live: boolean; cut: boolean }) {
  return input.live && !input.cut;
}

export function shouldListenContinuously(mode: VoiceMode) {
  return mode === 'listening' || mode === 'live';
}

export function normalizeVoiceText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseWakeCommand(value: string) {
  const normalized = normalizeVoiceText(value);
  const match = normalized.match(/^(?:hey\s+)?jarvis\b[\s,.:;!?-]*/i);
  if (!match) return { activated: false, command: '' };
  return { activated: true, command: normalizeVoiceText(normalized.slice(match[0].length)) };
}

export function shouldSpeakResponse(mode: VoiceMode) {
  return mode === 'live';
}

export function getDictationHotkey() {
  return { modifier: 'Space', code: 'KeyL' } as const;
}

export function getCoreTone(input: { listening: boolean; speaking: boolean }): CoreTone {
  if (input.speaking) return 'speaking';
  if (input.listening) return 'listening';
  return 'idle';
}
