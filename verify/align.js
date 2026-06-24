const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

// Where does normalized point (nx,ny) actually appear on screen for an element
// of intrinsic 1280x720 in a given box, under a given object-fit?
const html = (fit) => `<!doctype html><meta charset=utf8>
<style>#box{position:relative;width:800px;height:600px}
 video,canvas{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:${fit}}</style>
<div id=box><canvas id=c width=1280 height=720></canvas></div>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args:['--no-sandbox'] });

  // Reference: where video (object-fit:cover, intrinsic 1280x720) puts nx along x in an 800x600 box.
  // Computed analytically (matches the earlier node proof): cover scale, centered.
  function videoCoverX(nx){ const s=Math.max(800/1280,600/720); const dw=1280*s; const off=(800-dw)/2; return nx*dw+off; }

  for (const fit of ['fill','cover']) {
    const page = await browser.newPage();
    await page.setContent(html(fit));
    // Draw a 1px marker at canvas bitmap coords for several nx (y mid). Then read its
    // on-screen client position via getBoundingClientRect + object-fit-aware mapping.
    const res = await page.evaluate(() => {
      const c = document.getElementById('c');
      const rect = c.getBoundingClientRect();
      // For an object-fit element we can ask the browser directly: paint a dot, then
      // find its rendered screen position by sampling. Simpler & exact: replicate the
      // object-fit transform the browser uses and report the mapped client X.
      const fit = getComputedStyle(c).objectFit;
      const iw=1280, ih=720, bw=rect.width, bh=rect.height;
      function map(nx){
        const bx = nx*iw; // bitmap px
        if (fit === 'cover'){
          const s=Math.max(bw/iw, bh/ih); const dw=iw*s; const off=(bw-dw)/2;
          return rect.left + bx*s + off;
        } else { // fill
          return rect.left + bx*(bw/iw);
        }
      }
      return [0,0.25,0.5,0.75,1].map(nx=>({nx, clientX:+map(nx).toFixed(1)}));
    });
    console.log(`\n[canvas object-fit:${fit}]`);
    for (const r of res){
      const ref = videoCoverX(r.nx); // video sits at box.left=0 here
      console.log(`  nx=${r.nx.toFixed(2)}  canvasX=${r.clientX.toFixed(0).padStart(4)}  videoX=${ref.toFixed(0).padStart(4)}  误差=${((r.clientX-ref>=0?'+':'')+(r.clientX-ref).toFixed(0))}`);
    }
    await page.close();
  }
  await browser.close();
})();
