import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('https://jarvis.76.13.176.71.sslip.io', { waitUntil: 'networkidle', timeout: 60000 });
await page.getByRole('button', { name: 'CADENCE' }).click();
await page.getByRole('button', { name: 'RESOURCES' }).click();
await page.waitForSelector('.capacity-dial', { timeout: 60000 });
await page.waitForTimeout(1000);
const text = await page.locator('#section-productivity').innerText({ timeout: 30000 });
const buttonText = await page.locator('#section-productivity button').evaluateAll((buttons) => buttons.map((button) => button.textContent || ''));
const dialCount = await page.locator('.capacity-dial').count();
await page.screenshot({ path: '/root/jarvis-live-ui/artifacts/productivity-resources-wheel-live.png', fullPage: true });
console.log(JSON.stringify({
  hasResources: text.includes('RESOURCES'),
  hasResourceLogic: text.includes('RESOURCE LOGIC'),
  hasBureau: buttonText.includes('Bureau'),
  hasDemi: buttonText.includes('Demi'),
  hasNormale: buttonText.includes('Normale'),
  dialCount,
  errors,
}, null, 2));
await browser.close();
