import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const cssSource = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

describe('compact voice UI layout', () => {
  it('uses a compact three-mode voice selector instead of an oversized mute square', () => {
    expect(appSource).toContain('className="voice-mode-select"');
    expect(appSource).toContain('<option value="mute">MUTE</option>');
    expect(appSource).toContain('<option value="listening">LISTENING</option>');
    expect(appSource).toContain('<option value="live">LIVE</option>');
    expect(cssSource).not.toMatch(/\.voice-box\s*\{[\s\S]*?width:\s*36px/);
    expect(cssSource).toMatch(/\.voice-mode-select[\s\S]*?height:\s*22px/);
  });

  it('contains long Jarvis responses inside the panel without pushing under the page footer', () => {
    expect(cssSource).toMatch(/\.response-panel[\s\S]*?overflow:\s*hidden/);
    expect(cssSource).toMatch(/\.response-line[\s\S]*?min-height:\s*0/);
    expect(cssSource).toMatch(/\.response-text[\s\S]*?overflow:\s*auto/);
    expect(cssSource).toMatch(/\.response-text[\s\S]*?max-height:\s*36px/);
  });

  it('uses a less bloated vertical layout for the center stack', () => {
    expect(cssSource).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\) 58px 92px/);
    expect(cssSource).toMatch(/\.perimeter \.sphere-wrap[\s\S]*?width:\s*min\(30vh, 260px\)/);
  });
});
