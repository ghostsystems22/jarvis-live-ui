import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8') + '\n' + readFileSync(join(process.cwd(), 'src/components/ProductivitySection.tsx'), 'utf8');
const cssSource = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

describe('Cadence productivity redesign', () => {
  it('adds the internal Productivity sub-navigation pages', () => {
    expect(appSource).toContain("type ProductivityPage = 'overview' | 'tasks' | 'projects' | 'gantt' | 'cockpit' | 'resources'");
    for (const label of ['OVERVIEW', 'TASKS', 'PROJECTS', 'GANTT', 'COCKPIT', 'RESOURCES']) {
      expect(appSource).toContain(label);
    }
    expect(appSource).toContain('prod-subnav');
  });

  it('uses a readable white, blue, and black design system for Productivity', () => {
    expect(cssSource).toContain('--prod-bg:       #ffffff');
    expect(cssSource).toContain('--prod-blue:     #2563eb');
    expect(cssSource).toContain('--prod-ink:      #020617');
    expect(cssSource).toContain('#section-productivity');
    expect(cssSource).toContain('.glass');
  });

  it('preserves resource logic and the dynamic time wheel', () => {
    expect(appSource).toContain('function CapacityDial');
    expect(appSource).toContain('RESOURCE WHEEL');
    expect(appSource).toContain('RESOURCE LOGIC');
    expect(appSource).toContain('onSetCapacity(day.day, value)');
    expect(appSource).toContain('onPinTask(task)');
    expect(appSource).toContain('Bureau');
    expect(appSource).toContain('Demi');
    expect(appSource).toContain('Normale');
    expect(cssSource).toContain('.capacity-dial');
    expect(cssSource).toContain('.resource-wheel-panel');
  });
});
