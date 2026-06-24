const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log(`[PAGEERROR] ${err.message}`));
  page.on('requestfailed', req => console.log(`[REQFAIL] ${req.url().slice(0,80)} :: ${req.failure()?.errorText}`));

  await page.goto('file:///Users/m-yu/nail/files/nail-tryon-poc.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const s = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    statusText: document.querySelector('#status .status-text')?.textContent,
    HandsDefined: typeof window.Hands,
  }));
  console.log('[FILE:// STATE]', JSON.stringify(s, null, 2));

  // Try clicking Open Camera under file://
  await page.click('#startBtn');
  await new Promise(r => setTimeout(r, 2500));
  const after = await page.evaluate(() => ({
    overlayDisplay: document.getElementById('startOverlay').style.display,
    startMsg: document.getElementById('startMsg').textContent,
    hintShown: document.getElementById('startHint').style.display,
    videoHasStream: !!document.getElementById('video').srcObject,
  }));
  console.log('[FILE:// AFTER CAMERA]', JSON.stringify(after, null, 2));

  await browser.close();
})();
