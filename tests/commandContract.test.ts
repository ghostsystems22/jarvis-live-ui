import { describe, expect, it } from 'vitest';
import { assertAllowedSelection } from '../src/lib/commandContract';

describe('command selection contract', () => {
  it('accepts an allowlisted Hermes agent and model', () => {
    expect(assertAllowedSelection('jarvis', 'gpt-5.6-terra')).toEqual({
      agentId: 'jarvis',
      modelId: 'gpt-5.6-terra',
    });
  });

  it('rejects an unknown profile instead of sending it to Hermes', () => {
    expect(() => assertAllowedSelection('root', 'gpt-5.6-terra')).toThrow('Unsupported');
  });

  it('rejects an unknown model instead of passing it through', () => {
    expect(() => assertAllowedSelection('jarvis', 'not-a-model')).toThrow('Unsupported');
  });
});
