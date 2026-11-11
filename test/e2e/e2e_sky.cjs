// Sky detection regression: the colour-based estimate and the repair of a bad AI sky.
// Needs `npm run dev` on :5173 and the sample photos in test/media/. No network or AI model required.
const { chromium } = require('playwright');
const fs = require('fs');
const M = require('path').join(__dirname, '../media/');

// expected share of the frame marked as sky [min, max]
const CASES = {
  'overcast.png': [0.3, 0.6], // grey sky over green hills
  'hill.jpg': [0.2, 0.5], // hazy cloudy sky over a lake (phone screenshot with a black border)
  'rocket.jpg': [0.35, 0.75], // dark dusk sky behind launch towers
  'chelsea.png': [0, 0], // close-up of a cat: no sky
  'coffee.png': [0, 0], // espresso on a table: no sky
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.goto('http://localhost:5173/');
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
    if (!ok) failed++;
  };
  const run = (file, fn) => {
    const src = (file.endsWith('.jpg') ? 'data:image/jpeg;base64,' : 'data:image/png;base64,') + fs.readFileSync(M + file).toString('base64');
    return p.evaluate(async ({ src, fn }) => {
      const ai = await import('/src/engine/ai.ts');
      const img = new Image();
      img.src = src;
      await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;
      const cov = (m) => { let n = 0; for (const v of m) if (v > 127) n++; return n / m.length; };
      const small = document.createElement('canvas');
      const s = Math.min(1, ai.SKY_EST_SIZE / Math.max(w, h));
      small.width = Math.round(w * s); small.height = Math.round(h * s);
      small.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, small.width, small.height);
      if (fn === 'estimate') return { cov: cov(ai.estimateSky(small)) };
      // a saved AI result with an implausible sky (a few pixels at the bottom) or a good one (top third)
      const mk = (good) => {
        const rw = 64, rh = 64, sky = new Uint8Array(rw * rh);
        if (good) sky.fill(255, 0, rw * 22); else sky.fill(255, rw * (rh - 2), rw * (rh - 2) + 20);
        return { w: rw, h: rh, source: 'ai', maps: { sky } };
      };
      const r = ai.repairSky(mk(fn === 'repair-good'), img, w, h);
      return { changed: !!r, cov: r && r.maps.sky ? cov(r.maps.sky) : 0, dropped: !!r && !r.maps.sky };
    }, { src, fn });
  };

  for (const [file, [lo, hi]] of Object.entries(CASES)) {
    const { cov } = await run(file, 'estimate');
    check(`estimate ${file}`, cov >= lo && cov <= hi, `${(cov * 100).toFixed(1)}% (want ${lo * 100}–${hi * 100}%)`);
  }
  const bad = await run('overcast.png', 'repair-bad');
  check('repair: implausible AI sky is replaced by the colour sky', bad.changed && bad.cov > 0.3, `changed=${bad.changed} sky=${(bad.cov * 100).toFixed(1)}%`);
  const good = await run('overcast.png', 'repair-good');
  check('repair: believable AI sky is left alone', !good.changed, `changed=${good.changed}`);
  const none = await run('coffee.png', 'repair-bad');
  check('repair: no sky anywhere → sky dropped (UI says "no sky found")', none.changed && none.dropped, `changed=${none.changed} dropped=${none.dropped}`);
  await b.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
