import { describe, expect, it, vi } from 'vitest';
import { createVoiceCapture } from '../src/lib/voiceCapture';

describe('voice capture', () => {
  it('stops tracks when a recording is cancelled', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const capture = createVoiceCapture({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      MediaRecorder: class {} as unknown as typeof MediaRecorder,
    });

    await capture.prepare();
    capture.release();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('surfaces a microphone permission failure without leaving capture active', async () => {
    const capture = createVoiceCapture({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
      MediaRecorder: class {} as unknown as typeof MediaRecorder,
    });

    await expect(capture.prepare()).rejects.toThrow('Microphone permission was not granted');
    expect(capture.isActive()).toBe(false);
  });
});
