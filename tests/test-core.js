// node tests/test-core.js  — โหลด Code.gs + TimesheetOcr.gs ใน vm พร้อมตัวจำลอง Apps Script
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');

let fetchQueue = [], fetchLog = [], props = {}, cacheStore = {};
const ctx = {
  console, Logger: { log() {} },
  Utilities: {
    getUuid: () => 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)),
    formatDate: () => '2026-10-08', base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    base64Encode: b => Buffer.from(b).toString('base64'),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => props[k] = v, deleteProperty: k => delete props[k] }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] ?? null, put: (k, v) => cacheStore[k] = v }) },
  UrlFetchApp: { fetch: (url, opt) => { fetchLog.push({ url, opt }); const r = fetchQueue.shift(); return { getResponseCode: () => r[0], getContentText: () => r[1] }; } },
  ContentService: {}, HtmlService: {}, LockService: {}, SpreadsheetApp: {}, DriveApp: {},
};
vm.createContext(ctx);
for (const f of ['Code.gs', 'TimesheetOcr.gs']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const run = s => vm.runInContext(s, ctx);

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)));
}
const cfg = { normal_hours: 8, ot_multiplier: 1.5, break_minutes: 60, ot_min_minutes: 0 };
ctx.cfg = cfg;
const wd = (a, b, brk, c = cfg) => { ctx.args = [a, b, brk, c]; return run('workDay_.apply(null,args)'); };

// ── workDay_ ──
t('09-18 พัก60 = 8 ชม. ไม่มี OT', wd('09:00', '18:00', 60), { regular_min: 480, ot_min: 0, break_min: 60 });
t('09-18:30 = OT 30 นาที', wd('09:00', '18:30', 60), { regular_min: 480, ot_min: 30, break_min: 60 });
t('break 0 ยังหักพักตั้งต้น', wd('09:00', '18:00', 0).regular_min, 480);
t('break ว่างยังหักพักตั้งต้น', wd('09:00', '18:00', '').break_min, 60);
t('พักเอง 30 นาที', wd('09:00', '17:30', 30), { regular_min: 480, ot_min: 0, break_min: 30 });
t('ครึ่งวัน 09-12 พัก60 หักพักจริง', wd('09:00', '12:00', 0).regular_min, 120);
t('OT ขั้นต่ำ 30: OT 29 → 0', wd('09:00', '18:29', 60, { ...cfg, ot_min_minutes: 30 }).ot_min, 0);
t('OT ขั้นต่ำ 30: OT 30 พอดี → นับ', wd('09:00', '18:30', 60, { ...cfg, ot_min_minutes: 30 }).ot_min, 30);
t('OT ขั้นต่ำ 30: OT 31 → นับ', wd('09:00', '18:31', 60, { ...cfg, ot_min_minutes: 30 }).ot_min, 31);
t('เวลาออกก่อนเข้า (ข้ามคืน) = error', typeof wd('22:00', '06:00', 60).error, 'string');
t('เวลาผิดรูปแบบ = error', typeof wd('9am', '18:00', 60).error, 'string');
t('ทำงานสั้นกว่าพัก ไม่ติดลบ', wd('09:00', '09:30', 60).regular_min, 0);
t('รับ 9.30 แบบจุด', wd('9.30', '18.30', 60).regular_min, 480);

// ── calcEmployee_ ──
const emp = { id: 'E1', name: 'สมชาย' };
const days = [
  { date: '2026-10-01', time_in: '09:00', time_out: '18:00', break_min: 60 },
  { date: '2026-10-02', time_in: '09:00', time_out: '19:00', break_min: 60 }, // OT 60
  { date: '2026-10-03', time_in: 'xx', time_out: '19:00', break_min: 60 },    // error
];
ctx.a = [emp, 100, days, [{ type: 'add', label: 'เบี้ยขยัน', amount: 200 }, { type: 'deduct', label: 'ขาดงาน', amount: 150.5 }], cfg];
const r = run('calcEmployee_.apply(null,a)');
t('ชั่วโมงปกติ 16', r.regular_h, 16);
t('OT 1 ชม.', r.ot_h, 1);
t('ค่าแรงปกติ 1600', r.regular_pay, 1600);
t('ค่า OT 100×1.5=150', r.ot_pay, 150);
t('gross = 1600+150+200', r.gross, 1950);
t('net = gross − 150.50', r.net, 1799.5);
t('แถวเวลาเสียถูกรายงาน ไม่ทำให้พัง', r.errors.length, 1);
ctx.a = [emp, 33.33, [{ date: 'd', time_in: '09:00', time_out: '14:20', break_min: 60 }], [], cfg];
t('ปัดเศษ 2 ตำแหน่ง (4h20m×33.33)', run('calcEmployee_.apply(null,a)').regular_pay, 144.43);

// ── rate / validation ──
ctx.a = [{ rate_override: '', position_id: 'P1' }, [{ id: 'P1', rate: '120' }]];
t('ค่าแรงตามตำแหน่ง', run('empRate_.apply(null,a)'), 120);
ctx.a = [{ rate_override: '150', position_id: 'P1' }, [{ id: 'P1', rate: '120' }]];
t('ค่าแรงเฉพาะบุคคลชนะ', run('empRate_.apply(null,a)'), 150);
t('วันที่จริง 2026-02-28', run("validDate_('2026-02-28')"), true);
t('วันที่ปลอม 2026-02-30', run("validDate_('2026-02-30')"), false);

// ── cellVal_: เวลาอย่างเดียว (1899) ต้องไม่เลื่อน ──
ctx.d = { getFullYear: () => 1899, getHours: () => 9, getMinutes: () => 5 };
Object.setPrototypeOf(ctx.d, vm.runInContext('Date.prototype', ctx));
t('cellVal_ เวลา 1899 อ่าน getHours ตรงๆ', run('cellVal_(d)'), '09:05');

// ── OCR normalize ──
ctx.o = [{ date: '8/10/2569', time_in: '9:00', time_out: '18:00', break_min: '60' }, { date: '2569-10-09', time_in: '09:00', time_out: '17:00' }, { date: '2026-10-10', time_in: '??', time_out: '17:00' }];
const n = run('normalizeOcr_(o)');
t('OCR d/m/พ.ศ. แปลงเป็น ค.ศ.', n.rows[0].date, '2026-10-08');
t('OCR yyyy-mm-dd พ.ศ. แปลงเป็น ค.ศ.', n.rows[1].date, '2026-10-09');
t('OCR ข้ามแถวอ่านไม่ได้ ไม่เดา', n.skipped, 1);

// ── Gemini: ลำดับรุ่น / ข้อความผิดพลาด / คีย์ไม่หลุด ──
const KEY = 'AIzaSyFAKEKEYFAKEKEYFAKEKEY123456789';
const reset = () => { fetchQueue = []; fetchLog = []; cacheStore = {}; props = { GEMINI_API_KEY: KEY }; };
const ok = txt => [200, JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }] })];
const err = (c, m) => [c, JSON.stringify({ error: { message: m } })];
const gen = () => { try { return run("geminiGenerate_([{text:'x'}],false)"); } catch (e) { return { thrown: e.message }; } };

reset(); fetchQueue = [ok('OK')];
t('รุ่นแรก gemini-3.5-flash', (gen(), fetchLog[0].url.includes('gemini-3.5-flash')), true);
t('คีย์อยู่ใน header ไม่อยู่ใน URL', [fetchLog[0].url.includes('AIza'), fetchLog[0].opt.headers['x-goog-api-key'] === KEY], [false, true]);
reset(); fetchQueue = [err(404, 'model not found'), ok('OK')];
t('404 → ถอยไป gemini-2.5-flash', (gen(), fetchLog[1].url.includes('gemini-2.5-flash')), true);
reset(); fetchQueue = [err(403, 'Your project has been denied access. Please contact support.')];
let g = gen();
t('403 denied: หยุดทันที ไม่ลองรุ่นอื่น', fetchLog.length, 1);
t('403 denied: ข้อความบอกให้สร้างโปรเจกต์ใหม่', /โปรเจกต์ใหม่/.test(g.thrown), true);
reset(); fetchQueue = [err(400, 'API key not valid. Please pass a valid API key. ' + KEY)];
g = gen();
t('400 คีย์ผิด: ข้อความไม่มีคีย์หลุด', g.thrown.includes(KEY), false);
reset(); props.GEMINI_API_KEY = 'k1k1k1k1k1k1,k2k2k2k2k2k2'; fetchQueue = [err(401, 'bad'), ok('OK')];
t('คีย์แรกเสีย → ลองคีย์ที่สอง', (gen(), fetchLog[1].opt.headers['x-goog-api-key']), 'k2k2k2k2k2k2');
reset(); delete props.GEMINI_API_KEY;
t('ไม่มีคีย์ → ข้อความบอกให้ตั้งค่า', /GEMINI_API_KEY/.test(gen().thrown), true);
reset(); fetchQueue = [ok('OK'), ok('OK')];
run('apiTestKey_()');
let thrown = ''; try { run('apiTestKey_()'); } catch (e) { thrown = e.message; }
t('ทดสอบคีย์ซ้ำเร็ว → รอ 30 วินาที', /30/.test(thrown), true);

// ── dispatcher: ฟังก์ชันสาธารณะต้องมีแค่ที่กำหนด ──
const src = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8') + fs.readFileSync(path.join(root, 'TimesheetOcr.gs'), 'utf8');
const pub = [...src.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)].map(m => m[1]).filter(n => !n.endsWith('_')).sort();
t('ฟังก์ชันสาธารณะ', pub, ['doGet', 'doPost', 'run', 'setup', 'setupBotSecret']);
t('run() ปฏิเสธชื่อที่ไม่อยู่ใน whitelist', JSON.parse(run("run('setup')")).ok, false);

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
