// Storybook MSW smoke check: run `npm run storybook` first, then `node tests/msw-smoke.mjs`.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [id, expectText] of [
  ['viewer-structureviewer--castle-keep', '8 × 6 × 8'],
  ['viewer-structureviewer--castle-keep', 'Live'],
  ['viewer-structureviewer--empty-canvas', 'This structure is empty.'],
  ['viewer-structureviewer--broken-structure', 'The builder agent lost this structure.'],
]) {
  await page.goto(`http://localhost:6006/iframe.html?id=${id}`);
  try {
    await page.getByText(expectText).first().waitFor({ timeout: 20000 });
    console.log('PASS', id, '→', expectText);
  } catch {
    console.log('FAIL', id, '-', expectText);
    console.log('BODY:', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
  }
}
await browser.close();
