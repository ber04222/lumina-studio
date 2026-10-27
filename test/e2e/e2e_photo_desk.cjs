const { chromium } = require('playwright');
const S = (process.env.SHOTS || 'shots');
const M = require('path').join(__dirname, '../media/');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `${S}/${n}.png` }); };
  await p.goto('http://localhost:5173/#photo');
  await p.waitForTimeout(1200);
  // library already has photos from the mobile run? (new context = fresh storage) → import
  await p.locator('input[type=file][accept="image/*"]').setInputFiles([M + 'astronaut.png']);
  await p.waitForTimeout(3000);
  await shot('d01-editor');
  const canvas = p.locator('canvas').first();
  const box = await canvas.boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  // WB picker
  await p.getByRole('tab', { name: 'Color', exact: true }).click();
  await p.getByRole('button', { name: /Pick neutral/ }).click();
  let q = at(0.5, 0.12); await p.mouse.click(q.x, q.y);
  await shot('d02-wb');
  // undo / redo
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300);
  // Masking: brush
  await p.getByRole('button', { name: 'Masking' }).click();
  await p.getByRole('button', { name: 'Brush', exact: true }).click();
  q = at(0.3, 0.4); await p.mouse.move(q.x, q.y); await p.mouse.down();
  for (let i = 0; i < 12; i++) { const r = at(0.3 + i * 0.02, 0.4 + Math.sin(i / 2) * 0.05); await p.mouse.move(r.x, r.y); }
  await p.mouse.up();
  await shot('d03-brush');
  // local exposure on the brush mask
  const exp = p.getByRole('slider', { name: 'Exposure' });
  const eb = await exp.boundingBox();
  await p.mouse.move(eb.x + eb.width / 2, eb.y + eb.height - 4); await p.mouse.down(); await p.mouse.move(eb.x + eb.width * 0.85, eb.y + eb.height - 4, { steps: 6 }); await p.mouse.up();
  await shot('d04-brush-exposure');
  // add linear (new mask)
  await p.getByRole('button', { name: 'All masks' }).click();
  await p.getByRole('button', { name: 'Linear', exact: true }).click();
  await shot('d05-linear');
  await p.getByRole('button', { name: 'All masks' }).click();
  await p.getByRole('button', { name: 'Radial', exact: true }).click();
  await shot('d06-radial');
  await p.getByRole('button', { name: 'All masks' }).click();
  await p.getByRole('button', { name: 'Color range', exact: true }).click();
  q = at(0.25, 0.75); await p.mouse.click(q.x, q.y);
  await shot('d07-colorrange');
  // subject (estimate)
  await p.getByRole('button', { name: 'All masks' }).click();
  await p.getByRole('button', { name: 'Subject', exact: true }).first().click();
  await p.waitForTimeout(5000);
  await shot('d08-subject');
  // scopes + clipping
  await p.getByRole('button', { name: 'More' }).click();
  await p.getByRole('button', { name: /Show scopes/ }).click();
  await shot('d09-scopes');
  // LUT export
  await p.getByRole('button', { name: 'Edit' }).click();
  await p.getByRole('tab', { name: 'LUT' }).click();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Export as .cube/ }).click()]);
  await dl.saveAs(`${S}/look.cube`);
  // import that LUT back
  await p.locator('input[type=file][accept=".cube"]').setInputFiles([`${S}/look.cube`]);
  await p.waitForTimeout(1500);
  await shot('d10-lut');
  // copy settings → paste on another photo
  await p.getByRole('button', { name: 'More' }).click();
  await p.getByRole('button', { name: /Copy settings/ }).click();
  await p.locator('div[role=dialog] button.btn-accent').click();
  await p.getByRole('button', { name: 'Back to library' }).click();
  await p.locator('input[type=file][accept="image/*"]').setInputFiles([M + 'rocket.jpg']);
  await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'More' }).click();
  await p.getByRole('button', { name: /Paste settings/ }).click();
  await shot('d11-pasted');
  // grading wheel drag
  await p.getByRole('tab', { name: 'Grading' }).click();
  const wheel = p.getByRole('group', { name: 'Shadows colour wheel' });
  const wb = await wheel.boundingBox();
  await p.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await p.mouse.down(); await p.mouse.move(wb.x + wb.width * 0.2, wb.y + wb.height * 0.3, { steps: 5 }); await p.mouse.up();
  await shot('d12-grading');
  console.log('cube lines', require('fs').readFileSync(`${S}/look.cube`, 'utf8').split('\n').length);
  console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
