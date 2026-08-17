import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('https://jarvis.76.13.176.71.sslip.io', { waitUntil: 'networkidle', timeout: 60000 });
await page.getByRole('button', { name: 'CADENCE' }).click();
await page.waitForSelector('.prod-subnav-item', { timeout: 60000 });
await page.waitForTimeout(1500);
const text = await page.locator('#section-productivity').innerText({ timeout: 30000 });
await page.screenshot({ path: '/root/jarvis-live-ui/artifacts/productivity-redesign-live.png', fullPage: true });
console.log(JSON.stringify({
  hasOverview: text.includes('OVERVIEW'),
  hasTasks: text.includes('TASKS'),
  hasProjects: text.includes('PROJECTS'),
  hasGantt: text.includes('GANTT'),
  hasCockpit: text.includes('COCKPIT'),
  hasHero: text.toLowerCase().includes('executable plan'),
  errors,
}, null, 2));
await browser.close();
