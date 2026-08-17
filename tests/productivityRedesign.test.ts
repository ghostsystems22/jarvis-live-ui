import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8') + '\n' + readFileSync(join(process.cwd(), 'src/components/ProductivitySection.tsx'), 'utf8');
const cssSource = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

describe('Cadence productivity redesign', () => {
  it('adds the internal Productivity sub-navigation pages', () => {
    expect(appSource).toContain("type ProductivityPage = 'overview' | 'tasks' | 'projects' | 'gantt' | 'cockpit'");
    for (const label of ['OVERVIEW', 'TASKS', 'PROJECTS', 'GANTT', 'COCKPIT']) {
      expect(appSource).toContain(label);
    }
    expect(appSource).toContain('prod-subnav');
  });

  it('uses the black and green glass design system for Productivity', () => {
    expect(cssSource).toContain('--green-500:    #22c55e');
    expect(cssSource).toContain('--glass-bg:      rgba(0,15,5,0.55)');
    expect(cssSource).toContain('#section-productivity');
    expect(cssSource).toContain('.glass');
  });

  it('replaces circular week gauges with horizontal bars and new pages', () => {
    expect(appSource).toContain('week-timeline');
    expect(appSource).toContain('timeline-fill');
    expect(appSource).toContain('task-detail-overlay');
    expect(appSource).toContain('project-card');
    expect(appSource).toContain('gantt-chart');
    expect(appSource).toContain('current-focus');
  });
});
