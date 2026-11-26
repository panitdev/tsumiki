import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });

// Home page: structure list served by MSW
await page.goto('http://localhost:3101/');
try {
  await page.getByText('castle-keep').first().waitFor({ timeout: 20000 });
  console.log('PASS home lists structures');
} catch {
  console.log('FAIL home list:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
}

// Viewer page: snapshot + SSE live connection, rendered client-side
await page.goto('http://localhost:3101/castle-keep');
try {
  await page.getByText('Live').first().waitFor({ timeout: 20000 });
  await page.getByText('8 × 6 × 8').first().waitFor({ timeout: 5000 });
  console.log('PASS viewer renders with mocked snapshot + SSE (Live)');
} catch {
  console.log('FAIL viewer:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
}
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
await browser.close();
