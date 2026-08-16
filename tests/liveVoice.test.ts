import { describe, expect, it } from 'vitest';
import { normalizeVoiceText, shouldKeepLiveVoiceArmed } from '../src/lib/liveVoice';

describe('live voice control', () => {
  it('keeps live voice armed until the user cuts it', () => {
    expect(shouldKeepLiveVoiceArmed({ live: true, cut: false })).toBe(true);
    expect(shouldKeepLiveVoiceArmed({ live: true, cut: true })).toBe(false);
    expect(shouldKeepLiveVoiceArmed({ live: false, cut: false })).toBe(false);
  });

  it('normalizes speech before dispatch', () => {
    expect(normalizeVoiceText('  hello\nworld   ')).toBe('hello world');
  });
});
