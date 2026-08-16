import { describe, expect, it } from 'vitest';
import { getCoreTone, getDictationHotkey, parseWakeCommand, shouldListenContinuously, shouldSpeakResponse } from '../src/lib/liveVoice';

describe('Jarvis voice interaction modes', () => {
  it('requires Jarvis wake activation in live mode and strips the wake word', () => {
    expect(parseWakeCommand('background noise only')).toEqual({ activated: false, command: '' });
    expect(parseWakeCommand('Jarvis status report')).toEqual({ activated: true, command: 'status report' });
    expect(parseWakeCommand('hey jarvis   scan sector seven')).toEqual({ activated: true, command: 'scan sector seven' });
  });

  it('speaks only in live mode, while listening and mute modes return text only', () => {
    expect(shouldSpeakResponse('live')).toBe(true);
    expect(shouldSpeakResponse('listening')).toBe(false);
    expect(shouldSpeakResponse('mute')).toBe(false);
  });

  it('keeps voice recognition armed in listening/live, never in mute', () => {
    expect(shouldListenContinuously('mute')).toBe(false);
    expect(shouldListenContinuously('listening')).toBe(true);
    expect(shouldListenContinuously('live')).toBe(true);
  });

  it('uses Space+L as the manual dictation hotkey', () => {
    expect(getDictationHotkey()).toEqual({ code: 'KeyL', modifier: 'Space' });
  });

  it('colors the core blue when listening and red when speaking', () => {
    expect(getCoreTone({ listening: true, speaking: false })).toBe('listening');
    expect(getCoreTone({ listening: true, speaking: true })).toBe('speaking');
    expect(getCoreTone({ listening: false, speaking: false })).toBe('idle');
  });
});
