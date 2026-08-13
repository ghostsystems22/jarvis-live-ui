import { chromium } from 'playwright-core';
import fs from 'node:fs';

const baseURL = 'https://jarvis.76.13.176.71.sslip.io';
const password = process.env.JARVIS_UI_PASSWORD;
if (!password) throw new Error('JARVIS_UI_PASSWORD is required.');

const browser = await chromium.launch({
  executablePath: '/snap/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /establish link/i }).click();
  await page.locator('.dashboard').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'artifacts/visual/cockpit.png', fullPage: true });
  fs.writeFileSync('artifacts/visual/browser-check.json', JSON.stringify({
    title: await page.title(),
    agentButtons: await page.locator('.agent').count(),
    modelOptions: await page.locator('select option').count(),
    executeEnabled: await page.getByRole('button', { name: /execute/i }).isDisabled() === false,
    errors,
  }, null, 2));
} finally {
  await browser.close();
}
