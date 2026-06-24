const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Users/m-yu/.cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));
  await page.goto('http://localhost:8080/nail-tryon-poc.html', { waitUntil:'networkidle2' });
  await new Promise(r=>setTimeout(r,1200));

  const run = async (thumbTipZ) => page.evaluate((thumbTipZ) => {
    const L=(x,y,z)=>({x,y,z});
    const lm=new Array(21).fill(0).map(()=>L(0.5,0.5,0));
    lm[0]=L(0.5,0.85,0);                                  // wrist
    // thumb 1..4 (distal IP=3, TIP=4)
    lm[1]=L(0.30,0.75,0); lm[2]=L(0.25,0.66,0); lm[3]=L(0.22,0.58,0); lm[4]=L(0.20,0.50,thumbTipZ);
    // 4 fingers facing camera, pointing up, z~0
    const cols=[0.40,0.50,0.60,0.70];
    [[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]].forEach((idx,i)=>{
      const x=cols[i];
      lm[idx[0]]=L(x,0.60,0); lm[idx[1]]=L(x,0.48,0); lm[idx[2]]=L(x,0.36,0); lm[idx[3]]=L(x,0.24,0);
    });
    const c=document.getElementById('overlay'); const cx2=c.getContext('2d');
    cx2.clearRect(0,0,c.width,c.height);
    window.onResults({ multiHandLandmarks:[lm] });
    const W=c.width,H=c.height;
    const off=0.72;
    const painted=(dipN,tipN)=>{                          // sample 16x16 box at nail center
      const px=Math.round((dipN.x+(tipN.x-dipN.x)*off)*W);
      const py=Math.round((dipN.y+(tipN.y-dipN.y)*off)*H);
      const d=cx2.getImageData(px-8,py-8,16,16).data; let n=0;
      for(let i=3;i<d.length;i+=4) if(d[i]>0) n++;
      return n;
    };
    return {
      thumb: painted(lm[3],lm[4]),
      index: painted(lm[7],lm[8]),
      middle:painted(lm[11],lm[12]),
      ring:  painted(lm[15],lm[16]),
      pinky: painted(lm[19],lm[20]),
    };
  }, thumbTipZ);

  console.log('[A] thumb edge-on (tip.z=-0.12):', JSON.stringify(await run(-0.12)));
  console.log('[B] thumb facing  (tip.z= 0.00):', JSON.stringify(await run(0)));

  await browser.close();
})();
