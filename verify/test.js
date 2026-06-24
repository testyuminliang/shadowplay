const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[console.${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGEERROR] ${err.message}`));
  page.on('requestfailed', req => console.log(`[REQFAIL] ${req.url()} :: ${req.failure()?.errorText}`));

  try {
    await page.goto('http://localhost:8080/nail-tryon-poc.html', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.log(`[GOTO ERROR] ${e.message}`);
  }

  // wait a bit for async init
  await new Promise(r => setTimeout(r, 4000));

  // Inspect runtime state
  const state = await page.evaluate(() => {
    return {
      title: document.title,
      statusText: document.querySelector('#status .status-text')?.textContent,
      HandsDefined: typeof window.Hands,
      CameraDefined: typeof window.Camera,
      handsReady: window.handsReady,
      startBtnExists: !!document.getElementById('startBtn'),
      bodyChildCount: document.body.childElementCount,
    };
  });
  console.log('[STATE]', JSON.stringify(state, null, 2));

  await browser.close();
})();
