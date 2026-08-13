import { describe, expect, it } from 'vitest';
import { speechText } from '../src/lib/speech';

describe('speech output', () => {
  it('removes command noise and bounds the TTS payload', () => {
    const input = `# Result\n\n\`inline\` and **bold**\n\n\`\`\`ts\nsecret()\n\`\`\``;
    expect(speechText(input)).toBe('Result inline and bold Code output omitted.');
    expect(speechText('x'.repeat(2600))).toHaveLength(2400);
  });
});
