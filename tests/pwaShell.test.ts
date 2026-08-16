import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

describe('installable mobile shell', () => {
  it('declares a standalone app manifest and iOS fullscreen metadata', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('viewport-fit=cover');
  });
});
