// node tests/ui-smoke.js — รัน Code.gs จริง + Index.html จริงในเบราว์เซอร์ โดยจำลอง Sheets/Drive ในหน่วยความจำ
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

// ── ตัวจำลอง Sheets ──
function fakeSheet(name) {
  const d = []; // d[r][c]
  const sh = {
    name, fmt: {},
    getLastRow: () => d.length, getLastColumn: () => d.reduce((m, r) => Math.max(m, r.length), 0), getMaxRows: () => 1000,
    setFrozenRows() { }, getName: () => name,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (d[r - 1 + i] && d[r - 1 + i][c - 1 + j]) ?? '')),
        setValues: v => v.forEach((row, i) => row.forEach((x, j) => { (d[r - 1 + i] = d[r - 1 + i] || [])[c - 1 + j] = x; })),
        setValue: x => { (d[r - 1] = d[r - 1] || [])[c - 1] = x; },
        setNumberFormat() { }
      };
    },
    appendRow: v => d.push(v.slice()),
    deleteRow: r => d.splice(r - 1, 1),
  };
  return sh;
}
function fakeSS() {
  const sheets = [fakeSheet('Sheet1')];
  return {
    getId: () => 'SSID', getUrl: () => 'http://fake',
    getSheetByName: n => sheets.find(s => s.name === n) || null, getSheets: () => sheets,
    insertSheet: n => { const s = fakeSheet(n); sheets.push(s); return s; }, deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
}

const props = {}, files = {}, cache = {}; let ss = null, nid = 0;
const ctx = {
  console, Logger: { log() { } },
  Utilities: {
    getUuid: () => 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)),
    formatDate: () => '2026-10-08 10:00:00', base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => b > 127 ? b - 256 : b),
    base64Encode: b => Buffer.from(b.map(x => x & 255)).toString('base64'), newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => props[k] = v, deleteProperty: k => delete props[k] }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  UrlFetchApp: {}, ContentService: {}, HtmlService: {},
  SpreadsheetApp: { create: () => (ss = fakeSS()), openById: () => ss },
  DriveApp: {
    createFolder: () => ({ getId: () => 'FOLDER', createFile: b => { const id = 'F' + (++nid); files[id] = b; return { getId: () => id }; } }),
    getFolderById: () => ({ createFile: b => { const id = 'F' + (++nid); files[id] = b; return { getId: () => id }; } }),
    getFileById: id => id === 'SSID' ? { moveTo() { } } : { getBlob: () => ({ getBytes: () => files[id].bytes }), setTrashed: () => delete files[id] },
  },
};
vm.createContext(ctx);
for (const f of ['Code.gs', 'TimesheetOcr.gs']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
vm.runInContext('setup()', ctx);
ctx.__args = null;
const serverRun = (name, argsJson, pin) => { ctx.__a = [name, argsJson, pin]; return vm.runInContext('run.apply(null, __a)', ctx); };

let pass = 0, fail = 0;
const check = (name, cond, extra) => { cond ? pass++ : (fail++, console.log('FAIL', name, extra || '')); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.exposeFunction('__serverRun', serverRun);
  await page.addInitScript(() => {
    const mk = (ok, bad) => ({
      withSuccessHandler(f) { return mk(f, bad); }, withFailureHandler(f) { return mk(ok, f); },
      run(n, a, p) { window.__serverRun(n, a, p).then(ok, e => bad && bad({ message: String(e) })); }
    });
    window.google = { script: { run: mk() } };
  });
  await page.goto('file://' + path.join(root, 'Index.html'));

  // 1) ครั้งแรก: ยังไม่มีชื่อบริษัท → พาไปตั้งค่า
  await page.waitForSelector('text=โลโก้บริษัท');
  check('พาไปหน้าตั้งค่าเมื่อยังไม่มีชื่อบริษัท', page.url().endsWith('#set'));
  await page.fill('[data-k=company_name_th]', 'บริษัท ทดสอบ จำกัด');
  await page.fill('[data-k=ot_min_minutes]', '0');
  await page.click('#ss'); await page.waitForSelector('.msg.good');
  check('ชื่อบริษัทขึ้นแถบหัว', (await page.textContent('#hName')) === 'บริษัท ทดสอบ จำกัด');

  // 2) โลโก้: อัปโหลด → ขึ้นหัวเว็บ → ลบ
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#lf', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.click('#lu'); await page.waitForSelector('#lr');
  check('โลโก้ขึ้นแถบหัว', await page.isVisible('#hLogo'));
  await page.click('#lr'); await page.waitForSelector('#lu:not([disabled])');
  await page.waitForFunction(() => document.querySelector('#hLogo').classList.contains('hide'));
  check('ลบโลโก้แล้วหายจากแถบหัว', !(await page.isVisible('#hLogo')));
  // ปฏิเสธไฟล์ที่ไม่ใช่รูปจริง (ส่งข้อความธรรมดาตัวหลอก data URL)
  const bad = JSON.parse(serverRun('apiSaveLogo', JSON.stringify(['data:image/png;base64,' + Buffer.from('<?php evil ?>').toString('base64')])));
  check('ปฏิเสธไฟล์ที่ magic bytes ไม่ใช่รูป', bad.ok === false, JSON.stringify(bad));

  // 3) ตำแหน่ง + พนักงาน
  await page.click('nav a[href="#pos"]'); await page.waitForSelector('#pn');
  await page.fill('#pn', 'พนักงานทั่วไป'); await page.fill('#pr', '100'); await page.click('#ps'); await page.waitForSelector('text=พนักงานทั่วไป');
  await page.click('nav a[href="#emp"]'); await page.waitForSelector('#ei');
  await page.fill('#ei', 'EMP001 '); await page.fill('#en', 'สมชาย ใจดี'); await page.selectOption('#ep', { index: 1 });
  await page.fill('#eph', '081-234-5678'); await page.click('#es'); await page.waitForSelector('td:has-text("สมชาย ใจดี")');
  check('รหัสพนักงานถูก trim', (await page.textContent('table td')).trim() === 'EMP001' && !(await page.textContent('table td')).includes(' '));
  const emps = JSON.parse(serverRun('apiBootstrap', '[]')).data.employees;
  check('เบอร์โทรเก็บเป็นข้อความ เลข 0 หน้าไม่หาย', emps[0].phone === '0812345678', emps[0].phone);

  // 4) บันทึกเวลา: 09:00-18:30 พัก 60 → ปกติ 8 ชม. + OT 0.5
  await page.click('nav a[href="#ts"]'); await page.waitForSelector('#tadd');
  await page.selectOption('#te', 'EMP001'); await page.fill('#td', '2026-10-01'); await page.fill('#ti', '09:00'); await page.fill('#to', '18:30');
  await page.fill('#tf', '2026-10-01'); await page.fill('#tt', '2026-10-31');
  await page.click('#tadd'); await page.waitForSelector('.badge.ok');
  // กะข้ามเที่ยงคืนต้องถูกปฏิเสธพร้อมข้อความชัด
  await page.fill('#td', '2026-10-02'); await page.fill('#ti', '22:00'); await page.fill('#to', '06:00'); await page.click('#tadd');
  await page.waitForSelector('.msg.err');
  check('กะข้ามเที่ยงคืนถูกปฏิเสธ', (await page.textContent('.msg.err')).includes('ข้ามเที่ยงคืน'));

  // 5) ปรับเงิน +200
  await page.click('nav a[href="#adj"]'); await page.waitForSelector('#aa');
  await page.fill('#af', '2026-10-01'); await page.fill('#at', '2026-10-31');
  await page.selectOption('#ae', 'EMP001'); await page.fill('#alb', 'เบี้ยขยัน'); await page.fill('#aam', '200'); await page.click('#aa');
  await page.waitForSelector('td:has-text("เบี้ยขยัน")');

  // 6) คำนวณ → ออกสลิป → เปิดสลิป
  await page.click('nav a[href="#calc"]'); await page.waitForSelector('#cg');
  await page.fill('#cf', '2026-10-01'); await page.fill('#ct', '2026-10-31'); await page.click('#cg'); await page.waitForSelector('table tr td b');
  const body = await page.textContent('#cr');
  check('ชม.ปกติ 8 / OT 0.5', /\b8\b/.test(body) && body.includes('0.5'));
  check('สุทธิ = 800 + 75 + 200 = 1,075.00', body.includes('1,075.00'), body.slice(0, 300));
  await page.click('#ci'); await page.waitForSelector('.msg.good');
  await page.click('nav a[href="#slips"]'); await page.waitForSelector('[data-v]', { timeout: 5000 }).catch(() => { });
  await page.fill('#sf', '2026-10-01'); await page.fill('#st', '2026-10-31'); await page.click('#sl'); await page.waitForSelector('[data-v]');
  await page.click('[data-v]'); await page.waitForSelector('.slip');
  const slip = await page.textContent('.slip');
  check('สลิปมีชื่อบริษัท ชื่อพนักงาน ยอดสุทธิ', slip.includes('บริษัท ทดสอบ จำกัด') && slip.includes('สมชาย ใจดี') && slip.includes('1,075.00'));
  await page.screenshot({ path: path.join(__dirname, 'slip.png'), fullPage: true });

  // 7) หน้าที่เหลือเปิดได้ไม่ error + มือถือไม่เลื่อนแนวนอน
  for (const k of ['dash', 'form', 'ocr', 'log', 'set']) { await page.click(`nav a[href="#${k}"]`); await page.waitForTimeout(150); }
  await page.setViewportSize({ width: 390, height: 800 }); await page.click('nav a[href="#dash"]'); await page.waitForTimeout(200);
  check('มือถือไม่เลื่อนแนวนอนทั้งหน้า', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('ไม่มี JS error ในคอนโซล', errors.length === 0, errors.join(' | '));

  // 8) รหัสผ่านเข้าเว็บ
  props.APP_PIN = 'secret-1234';
  const js = (pin) => JSON.parse(serverRun('apiBootstrap', '[]', pin));
  check('ไม่ส่งรหัส → PIN_REQUIRED', /^PIN_REQUIRED/.test(js(undefined).error));
  check('รหัสผิด → PIN_WRONG', /^PIN_WRONG/.test(js('nope').error));
  check('รหัสถูก → เข้าได้', js('secret-1234').ok === true);
  for (let i = 0; i < 5; i++) js('bad');
  check('ผิดครบ 5 ครั้ง → ล็อก แม้ใส่รหัสถูก', /^PIN_LOCKED/.test(js('secret-1234').error));
  delete cache.pinfail;
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('file://' + path.join(root, 'Index.html'));
  await page.waitForSelector('#pinIn');
  check('เปิดเว็บแล้วเจอหน้าใส่รหัสผ่าน ไม่เห็นข้อมูล', !(await page.textContent('body')).includes('สมชาย'));
  await page.fill('#pinIn', 'wrong'); await page.press('#pinIn', 'Enter');
  await page.waitForSelector('.msg.err:has-text("ไม่ถูกต้อง")');
  await page.fill('#pinIn', 'secret-1234'); await page.press('#pinIn', 'Enter');
  await page.waitForSelector('text=ภาพรวม >> nth=1');
  await page.waitForSelector('.stat');
  check('ใส่รหัสถูกแล้วเข้าหน้าภาพรวมได้', await page.isVisible('.stat'));
  errors.length = 0;
  await browser.close();
  console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
