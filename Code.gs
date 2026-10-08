/**
 * ระบบเงินเดือนพนักงานรายชั่วโมง/Part-time — Google Apps Script
 * ขอบเขต: ค่าแรงรายชั่วโมง + OT + ปรับเงิน (เพิ่ม/หัก) + สลิป
 * ยังไม่รองรับ: ประกันสังคม, ภาษีขั้นบันไดหัก ณ ที่จ่าย, กะข้ามเที่ยงคืน
 *
 * กติกาความปลอดภัย: เว็บเปิดแบบไม่ต้องล็อกอิน + รันสิทธิ์เจ้าของ
 * ฟังก์ชันที่ไม่ลงท้าย "_" ใครมีลิงก์ก็เรียกได้ → ฟังก์ชันสาธารณะมีแค่
 * doGet, doPost, run, setup, setupBotSecret ที่เหลือลงท้าย "_" ทั้งหมด
 */

var SCHEMA_V = 1;
var TZ = 'Asia/Bangkok';
var SCHEMA = {
  Settings: ['key', 'value'],
  Positions: ['id', 'name', 'rate'],
  Employees: ['id', 'name', 'position_id', 'rate_override', 'phone', 'bank_account', 'status', 'line_user_id'],
  Timesheets: ['id', 'emp_id', 'date', 'time_in', 'time_out', 'break_min', 'note', 'status'],
  Adjustments: ['id', 'emp_id', 'from', 'to', 'type', 'label', 'amount'],
  Slips: ['id', 'emp_id', 'from', 'to', 'data', 'created'],
  Log: ['ts', 'action', 'detail']
};
// คอลัมน์ที่ต้องเป็นข้อความเสมอ (กันเลข 0 หน้าหาย / วันที่-เวลาถูกแปลงเป็น Date)
var TEXT_COLS = ['id', 'emp_id', 'position_id', 'phone', 'bank_account', 'line_user_id',
  'date', 'time_in', 'time_out', 'from', 'to', 'created', 'ts', 'key', 'status'];
var DEFAULTS = {
  company_name_th: '', company_name_en: '', address: '', tax_id: '', phone: '', email: '',
  normal_hours: '8', ot_multiplier: '1.5', break_minutes: '60', ot_min_minutes: '0'
};
var SETTING_KEYS = Object.keys(DEFAULTS);
var MEM_ = {}; // แคชต่อคำขอ (ตัวแปร global ถูกสร้างใหม่ทุกการรัน)

// ───────────────────────── จุดเข้า ─────────────────────────

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบเงินเดือน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function api_() { // สร้างตอนเรียก: ไฟล์ .gs โหลดไม่เรียงลำดับ อ้างข้ามไฟล์ตอนโหลดไม่ได้
  return {
  apiBootstrap: apiBootstrap_, apiSaveSettings: apiSaveSettings_,
  apiSaveLogo: apiSaveLogo_, apiRemoveLogo: apiRemoveLogo_,
  apiSavePosition: apiSavePosition_, apiDeletePosition: apiDeletePosition_,
  apiSaveEmployee: apiSaveEmployee_, apiDeactivateEmployee: apiDeactivateEmployee_,
  apiListTimesheets: apiListTimesheets_, apiSaveTimesheets: apiSaveTimesheets_,
  apiSetStatus: apiSetStatus_, apiDeleteTimesheets: apiDeleteTimesheets_,
  apiListAdjustments: apiListAdjustments_, apiSaveAdjustment: apiSaveAdjustment_,
  apiDeleteAdjustment: apiDeleteAdjustment_,
  apiCalc: apiCalc_, apiIssueSlips: apiIssueSlips_, apiListSlips: apiListSlips_,
  apiGetSlip: apiGetSlip_, apiLog: apiLog_,
  apiOcr: apiOcr_, apiTestKey: apiTestKey_
  };
}
var API_READ_ = { apiBootstrap: 1, apiListTimesheets: 1, apiListAdjustments: 1, apiCalc: 1, apiListSlips: 1, apiGetSlip: 1, apiLog: 1 };

/** ตัวกลางเดียวที่หน้าเว็บเรียก: คืน JSON string เสมอ (กัน google.script.run คืน null เมื่อมี Date) */
function run(name, argsJson) {
  var lock = null;
  try {
    var API = api_();
    if (!API.hasOwnProperty(name)) throw new Error('ไม่รู้จักคำสั่ง: ' + name);
    var args = argsJson ? JSON.parse(argsJson) : [];
    if (!API_READ_[name]) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    return JSON.stringify({ ok: true, data: API[name].apply(null, args) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err && err.message || err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** รันครั้งเดียวโดยเจ้าของ: สร้างโฟลเดอร์ + สเปรดชีต + ชีตทั้งหมด (รันซ้ำได้ ไม่ทับข้อมูล) */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var folder, ss;
  var fid = props.getProperty('FOLDER_ID');
  if (fid) { try { folder = DriveApp.getFolderById(fid); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder('Payroll_System'); props.setProperty('FOLDER_ID', folder.getId()); }
  var sid = props.getProperty('SS_ID');
  if (sid) { try { ss = SpreadsheetApp.openById(sid); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Payroll_Data');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('SS_ID', ss.getId());
  }
  Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); });
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  props.setProperty('SCHEMA_V', String(SCHEMA_V));
  seedSettings_();
  log_('setup', 'ติดตั้ง/ตรวจโครงชีต v' + SCHEMA_V);
  Logger.log('พร้อมใช้งาน สเปรดชีต: ' + ss.getUrl());
}

/** สร้างรหัสลับสำหรับบอท LINE — ไม่ return ค่า, ดูรหัสที่ Execution log, ออกซ้ำไม่ได้ถ้ามีอยู่แล้ว */
function setupBotSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BOT_SECRET')) {
    Logger.log('มีรหัสบอทอยู่แล้ว (ถ้าจะออกใหม่ ให้ลบ Script Property BOT_SECRET ก่อน)');
    return;
  }
  var secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  props.setProperty('BOT_SECRET', secret);
  Logger.log('BOT_SECRET = ' + secret);
}

/** รับจากบอท LINE: {secret, lineUserId, action:'slip'|'ocr', from?, to?, image?} */
function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('BOT_SECRET');
    if (!secret || !safeEq_(String(body.secret || ''), secret)) return out({ ok: false, error: 'unauthorized' });
    var lineId = String(body.lineUserId || '').trim();
    var emp = lineId ? rows_('Employees').filter(function (r) { return r.line_user_id === lineId && r.status === 'active'; })[0] : null;
    if (!emp) return out({ ok: false, error: 'ไม่พบพนักงานที่ผูกกับ LINE นี้' }); // ตัวตนมาจาก LINE user id เท่านั้น
    if (body.action === 'slip') {
      var slips = rows_('Slips').filter(function (s) {
        return s.emp_id === emp.id && (!body.from || s.from === body.from) && (!body.to || s.to === body.to);
      }).sort(function (a, b) { return a.created < b.created ? 1 : -1; });
      if (!slips.length) return out({ ok: false, error: 'ยังไม่มีสลิป' });
      return out({ ok: true, slip: JSON.parse(slips[0].data), settings: publicSettings_() });
    }
    if (body.action === 'ocr') {
      var lock = LockService.getScriptLock(); lock.waitLock(20000);
      try {
        var res = ocrImage_(String(body.image || ''));
        var saved = saveTimesheets_(res.rows.map(function (r) { r.emp_id = emp.id; r.status = 'pending'; return r; }));
        return out({ ok: true, saved: saved, rows: res.rows });
      } finally { lock.releaseLock(); }
    }
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: scrub_(String(err && err.message || err)) });
  }
}

function safeEq_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ───────────────────────── ชีต / ข้อมูล ─────────────────────────

function ss_() {
  if (MEM_.ss) return MEM_.ss;
  var id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (!id) throw new Error('ยังไม่ได้ติดตั้ง — เจ้าของต้องเปิดเอดิเตอร์แล้ว Run setup ก่อน');
  MEM_.ss = SpreadsheetApp.openById(id);
  return MEM_.ss;
}

function ensureSheet_(ss, name) {
  var cols = SCHEMA[name];
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  // เพิ่มคอลัมน์ต่อท้ายเท่านั้น ไม่เรียงใหม่
  for (var i = 0; i < cols.length; i++) {
    if (have[i] !== cols[i]) {
      if (have[i]) throw new Error('หัวคอลัมน์ชีต ' + name + ' ไม่ตรงโครง (ช่อง ' + (i + 1) + ')');
      sh.getRange(1, i + 1).setValue(cols[i]);
    }
    if (TEXT_COLS.indexOf(cols[i]) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  sh.setFrozenRows(1);
  return sh;
}

function cellVal_(v) {
  if (v instanceof Date) {
    if (v.getFullYear() <= 1900) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes()); // ค่า "เวลาอย่างเดียว" = 1899-12-30
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return typeof v === 'string' ? v.trim() : v;
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function txt_(v) { return v == null ? '' : String(v).trim(); }
function phoneTxt_(v) { return txt_(v).replace(/[^\d+]/g, ''); }

function rows_(name) {
  if (MEM_[name]) return MEM_[name];
  var sh = ss_().getSheetByName(name);
  var cols = SCHEMA[name], list = [];
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
    vals.forEach(function (row, i) {
      if (row.every(function (c) { return c === '' || c == null; })) return;
      var o = { _row: i + 2 };
      cols.forEach(function (c, j) { o[c] = cellVal_(row[j]); });
      list.push(o);
    });
  }
  MEM_[name] = list;
  return list;
}

function rowVals_(name, o) {
  return SCHEMA[name].map(function (c) {
    var v = o[c];
    if (v == null) return '';
    return TEXT_COLS.indexOf(c) >= 0 ? txt_(v) : v;
  });
}
function append_(name, o) {
  ss_().getSheetByName(name).appendRow(rowVals_(name, o));
  delete MEM_[name];
}
function update_(name, o) {
  var cols = SCHEMA[name];
  ss_().getSheetByName(name).getRange(o._row, 1, 1, cols.length).setValues([rowVals_(name, o)]);
  delete MEM_[name];
}
function remove_(name, row) {
  ss_().getSheetByName(name).deleteRow(row);
  delete MEM_[name];
}
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function log_(action, detail) {
  try { append_('Log', { ts: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), action: action, detail: String(detail || '').slice(0, 500) }); } catch (e) { }
}

// ───────────────────────── ตั้งค่า ─────────────────────────

function seedSettings_() {
  var have = {};
  rows_('Settings').forEach(function (r) { have[r.key] = 1; });
  SETTING_KEYS.forEach(function (k) { if (!have[k]) append_('Settings', { key: k, value: DEFAULTS[k] }); });
}
function settings_() {
  var o = {};
  SETTING_KEYS.forEach(function (k) { o[k] = DEFAULTS[k]; });
  rows_('Settings').forEach(function (r) { if (o.hasOwnProperty(r.key)) o[r.key] = txt_(r.value); });
  return o;
}
function publicSettings_() { var s = settings_(); s.logo = getLogo_(); return s; }
function cfg_() {
  var s = settings_();
  var num = function (v, d) { var n = parseFloat(v); return isFinite(n) && n >= 0 ? n : d; };
  return {
    normal_hours: num(s.normal_hours, 8) || 8,
    ot_multiplier: num(s.ot_multiplier, 1.5),
    break_minutes: num(s.break_minutes, 60),
    ot_min_minutes: num(s.ot_min_minutes, 0)
  };
}

function apiSaveSettings_(obj) {
  var changed = [];
  SETTING_KEYS.forEach(function (k) {
    if (!obj || !obj.hasOwnProperty(k)) return;
    var v = txt_(obj[k]).slice(0, 300);
    if (k === 'phone') v = txt_(obj[k]).replace(/[^\d+\-\s,]/g, '');
    if (['normal_hours', 'ot_multiplier', 'break_minutes', 'ot_min_minutes'].indexOf(k) >= 0) {
      var n = parseFloat(v);
      if (!isFinite(n) || n < 0 || (k === 'normal_hours' && (n <= 0 || n > 24))) throw new Error('ค่า ' + k + ' ไม่ถูกต้อง');
      v = String(n);
    }
    var row = rows_('Settings').filter(function (r) { return r.key === k; })[0];
    if (row) { row.value = v; update_('Settings', row); } else append_('Settings', { key: k, value: v });
    changed.push(k);
  });
  log_('settings', changed.join(','));
  return publicSettings_();
}

// ───────────────────────── โลโก้ ─────────────────────────

function sniffImage_(bytes) {
  var b = bytes;
  if (b.length > 8 && (b[0] & 255) === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b.length > 3 && (b[0] & 255) === 0xFF && (b[1] & 255) === 0xD8 && (b[2] & 255) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}
function decodeDataUrl_(dataUrl, maxBytes) {
  var m = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('ไฟล์ต้องเป็นรูป PNG/JPG/WEBP');
  if (m[1].length > maxBytes * 1.4) throw new Error('ไฟล์ใหญ่เกินไป');
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > maxBytes) throw new Error('ไฟล์ใหญ่เกินไป');
  var kind = sniffImage_(bytes); // ตรวจ magic bytes ไม่เชื่อ header ที่ผู้ใช้ส่ง
  if (!kind) throw new Error('เนื้อไฟล์ไม่ใช่รูปที่รองรับ');
  return { bytes: bytes, mime: kind.mime, ext: kind.ext, b64: m[1] };
}
function getLogo_() {
  var id = PropertiesService.getScriptProperties().getProperty('LOGO_ID');
  if (!id) return '';
  try {
    var blob = DriveApp.getFileById(id).getBlob();
    var kind = sniffImage_(blob.getBytes());
    if (!kind) return '';
    return 'data:' + kind.mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) { return ''; }
}
function apiSaveLogo_(dataUrl) {
  var img = decodeDataUrl_(dataUrl, 1500 * 1024);
  var props = PropertiesService.getScriptProperties();
  var old = props.getProperty('LOGO_ID');
  var folder = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
  var file = folder.createFile(Utilities.newBlob(img.bytes, img.mime, 'logo.' + img.ext));
  props.setProperty('LOGO_ID', file.getId());
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { } }
  log_('logo', 'อัปโหลดโลโก้');
  return getLogo_();
}
function apiRemoveLogo_() {
  var props = PropertiesService.getScriptProperties();
  var old = props.getProperty('LOGO_ID');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { } }
  props.deleteProperty('LOGO_ID');
  log_('logo', 'ลบโลโก้');
  return '';
}

// ───────────────────────── ตำแหน่ง / พนักงาน ─────────────────────────

function toRate_(v, what) {
  var n = parseFloat(String(v).replace(/,/g, ''));
  if (!isFinite(n) || n < 0) throw new Error(what + ' ต้องเป็นตัวเลขไม่ติดลบ');
  return Math.round(n * 100) / 100;
}

function apiSavePosition_(p) {
  var name = txt_(p.name);
  if (!name) throw new Error('กรอกชื่อตำแหน่ง');
  var rate = toRate_(p.rate, 'ค่าแรงต่อชั่วโมง');
  var all = rows_('Positions');
  var dup = all.filter(function (r) { return r.name === name && r.id !== p.id; })[0];
  if (dup) throw new Error('มีตำแหน่งชื่อนี้แล้ว');
  var row = p.id ? all.filter(function (r) { return r.id === p.id; })[0] : null;
  if (p.id && !row) throw new Error('ไม่พบตำแหน่ง');
  if (row) { row.name = name; row.rate = rate; update_('Positions', row); }
  else append_('Positions', { id: 'P' + newId_().slice(0, 6), name: name, rate: rate });
  log_('position', name + ' ' + rate);
  return rows_('Positions');
}
function apiDeletePosition_(id) {
  if (rows_('Employees').some(function (e) { return e.position_id === id; })) throw new Error('มีพนักงานใช้ตำแหน่งนี้อยู่ ลบไม่ได้');
  var row = rows_('Positions').filter(function (r) { return r.id === id; })[0];
  if (row) remove_('Positions', row._row);
  return rows_('Positions');
}

function apiSaveEmployee_(e) {
  var id = txt_(e.id); // รหัสพนักงาน trim ทุกจุด
  if (!id) throw new Error('กรอกรหัสพนักงาน');
  if (!/^[A-Za-z0-9_\-]{1,20}$/.test(id)) throw new Error('รหัสพนักงานใช้ได้เฉพาะ A-Z 0-9 _ - (ไม่เกิน 20 ตัว)');
  var name = txt_(e.name);
  if (!name) throw new Error('กรอกชื่อพนักงาน');
  var pos = txt_(e.position_id);
  if (pos && !rows_('Positions').some(function (p) { return p.id === pos; })) throw new Error('ไม่พบตำแหน่ง');
  var over = txt_(e.rate_override) === '' ? '' : toRate_(e.rate_override, 'ค่าแรงเฉพาะบุคคล');
  if (!pos && over === '') throw new Error('เลือกตำแหน่ง หรือกรอกค่าแรงเฉพาะบุคคล');
  var line = txt_(e.line_user_id);
  if (line && rows_('Employees').some(function (r) { return r.line_user_id === line && r.id !== id; })) throw new Error('LINE user id นี้ผูกกับพนักงานคนอื่นแล้ว');
  var obj = {
    id: id, name: name, position_id: pos, rate_override: over, phone: phoneTxt_(e.phone),
    bank_account: txt_(e.bank_account).replace(/[^\d\-]/g, ''), status: e.status === 'inactive' ? 'inactive' : 'active', line_user_id: line
  };
  var row = rows_('Employees').filter(function (r) { return r.id === id; })[0];
  if (e.isNew && row) throw new Error('รหัสพนักงานนี้มีอยู่แล้ว');
  if (row) { obj._row = row._row; update_('Employees', obj); } else append_('Employees', obj);
  log_('employee', id + ' ' + name);
  return rows_('Employees');
}
function apiDeactivateEmployee_(id) {
  var row = rows_('Employees').filter(function (r) { return r.id === txt_(id); })[0];
  if (!row) throw new Error('ไม่พบพนักงาน');
  row.status = row.status === 'active' ? 'inactive' : 'active';
  update_('Employees', row);
  return rows_('Employees');
}

function apiBootstrap_() {
  return {
    settings: publicSettings_(), positions: rows_('Positions'), employees: rows_('Employees'),
    pending: rows_('Timesheets').filter(function (t) { return t.status === 'pending'; }).length,
    ocrReady: geminiKeys_().length > 0
  };
}

// ───────────────────────── ใบลงเวลา ─────────────────────────

function validDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}
function parseHM_(s) {
  var m = /^(\d{1,2})[:.](\d{2})$/.exec(txt_(s));
  if (!m) return null;
  var h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
function fmtHM_(min) { return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60); }

function apiListTimesheets_(from, to, empId) {
  return rows_('Timesheets').filter(function (t) {
    return (!from || t.date >= from) && (!to || t.date <= to) && (!empId || t.emp_id === empId);
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.emp_id < b.emp_id ? -1 : 1; });
}

function saveTimesheets_(list) {
  var emps = {};
  rows_('Employees').forEach(function (e) { emps[e.id] = 1; });
  var saved = 0;
  list.forEach(function (t) {
    var emp = txt_(t.emp_id), date = txt_(t.date);
    if (!emps[emp]) throw new Error('ไม่พบพนักงาน ' + emp);
    if (!validDate_(date)) throw new Error('วันที่ไม่ถูกต้อง: ' + date);
    var a = parseHM_(t.time_in), b = parseHM_(t.time_out);
    if (a == null || b == null) throw new Error('เวลาไม่ถูกต้อง (' + date + ')');
    if (b <= a) throw new Error('เวลาออกต้องหลังเวลาเข้า — กะข้ามเที่ยงคืนยังไม่รองรับ (' + date + ')');
    var brk = t.break_min === '' || t.break_min == null ? 0 : parseInt(t.break_min, 10);
    if (!isFinite(brk) || brk < 0 || brk > 600) throw new Error('เวลาพักไม่ถูกต้อง (' + date + ')');
    var obj = {
      emp_id: emp, date: date, time_in: fmtHM_(a), time_out: fmtHM_(b), break_min: brk,
      note: txt_(t.note).slice(0, 200), status: t.status === 'approved' ? 'approved' : 'pending'
    };
    var ex = rows_('Timesheets').filter(function (r) { return r.emp_id === emp && r.date === date; })[0];
    if (ex) { obj.id = ex.id; obj._row = ex._row; update_('Timesheets', obj); }
    else { obj.id = newId_(); append_('Timesheets', obj); }
    saved++;
  });
  log_('timesheet', 'บันทึก ' + saved + ' แถว');
  return saved;
}
function apiSaveTimesheets_(list) {
  if (!Array.isArray(list) || !list.length || list.length > 200) throw new Error('จำนวนแถวไม่ถูกต้อง');
  return saveTimesheets_(list);
}
function apiSetStatus_(ids, status) {
  if (status !== 'approved' && status !== 'pending') throw new Error('สถานะไม่ถูกต้อง');
  var set = {}; (ids || []).forEach(function (i) { set[i] = 1; });
  var n = 0;
  rows_('Timesheets').forEach(function (t) { if (set[t.id]) { t.status = status; update_('Timesheets', t); n++; } });
  log_('timesheet-status', status + ' ' + n);
  return n;
}
function apiDeleteTimesheets_(ids) {
  var set = {}; (ids || []).forEach(function (i) { set[i] = 1; });
  var rows = rows_('Timesheets').filter(function (t) { return set[t.id]; }).sort(function (a, b) { return b._row - a._row; });
  rows.forEach(function (t) { remove_('Timesheets', t._row); });
  log_('timesheet-delete', rows.length);
  return rows.length;
}

// ───────────────────────── ปรับเงิน ─────────────────────────

function apiListAdjustments_(from, to) {
  return rows_('Adjustments').filter(function (a) { return (!from || a.from === from) && (!to || a.to === to); });
}
function apiSaveAdjustment_(a) {
  if (!validDate_(txt_(a.from)) || !validDate_(txt_(a.to))) throw new Error('ช่วงงวดไม่ถูกต้อง');
  if (!rows_('Employees').some(function (e) { return e.id === txt_(a.emp_id); })) throw new Error('ไม่พบพนักงาน');
  if (a.type !== 'add' && a.type !== 'deduct') throw new Error('ประเภทต้องเป็นเพิ่มหรือหัก');
  var label = txt_(a.label);
  if (!label) throw new Error('กรอกรายการ');
  var amount = toRate_(a.amount, 'จำนวนเงิน');
  if (amount <= 0) throw new Error('จำนวนเงินต้องมากกว่า 0');
  append_('Adjustments', { id: newId_(), emp_id: txt_(a.emp_id), from: a.from, to: a.to, type: a.type, label: label.slice(0, 100), amount: amount });
  log_('adjust', a.emp_id + ' ' + a.type + ' ' + amount);
  return apiListAdjustments_(a.from, a.to);
}
function apiDeleteAdjustment_(id, from, to) {
  var row = rows_('Adjustments').filter(function (r) { return r.id === id; })[0];
  if (row) remove_('Adjustments', row._row);
  return apiListAdjustments_(from, to);
}

// ───────────────────────── คำนวณ (ฟังก์ชันล้วน ทดสอบบน Node ได้) ─────────────────────────

var round2_ = function (n) { return Math.round((n + 1e-9) * 100) / 100; };

/**
 * 1 วันทำงาน → นาทีปกติ/OT
 * - break_min ว่างหรือ 0 = หักพักตามค่าตั้งต้น (ครึ่งวันไม่พัก ต้องกรอกชั่วโมงเอง)
 * - OT น้อยกว่า ot_min_minutes ปัดเป็น 0 ; เท่ากับขั้นต่ำ = ยังนับ
 */
function workDay_(tin, tout, breakMin, cfg) {
  var a = parseHM_(tin), b = parseHM_(tout);
  if (a == null || b == null) return { error: 'เวลาไม่ถูกต้อง' };
  if (b <= a) return { error: 'เวลาออกต้องหลังเวลาเข้า (ไม่รองรับกะข้ามเที่ยงคืน)' };
  var brk = +breakMin > 0 ? +breakMin : cfg.break_minutes;
  var worked = Math.max(0, b - a - brk);
  var normal = Math.round(cfg.normal_hours * 60);
  var reg = Math.min(worked, normal);
  var ot = worked - reg;
  if (ot < cfg.ot_min_minutes) ot = 0;
  return { regular_min: reg, ot_min: ot, break_min: brk };
}

function calcEmployee_(emp, rate, days, adjs, cfg) {
  var res = { emp_id: emp.id, name: emp.name, rate: rate, days: [], errors: [], regular_min: 0, ot_min: 0 };
  days.forEach(function (d) {
    var w = workDay_(d.time_in, d.time_out, d.break_min, cfg);
    if (w.error) { res.errors.push(d.date + ': ' + w.error); return; }
    res.regular_min += w.regular_min; res.ot_min += w.ot_min;
    res.days.push({ date: d.date, time_in: d.time_in, time_out: d.time_out, break_min: w.break_min, regular_min: w.regular_min, ot_min: w.ot_min, note: d.note || '' });
  });
  res.regular_h = round2_(res.regular_min / 60);
  res.ot_h = round2_(res.ot_min / 60);
  res.ot_multiplier = cfg.ot_multiplier;
  res.regular_pay = round2_(res.regular_min / 60 * rate);
  res.ot_pay = round2_(res.ot_min / 60 * rate * cfg.ot_multiplier);
  res.adds = adjs.filter(function (a) { return a.type === 'add'; }).map(function (a) { return { label: a.label, amount: +a.amount }; });
  res.deducts = adjs.filter(function (a) { return a.type === 'deduct'; }).map(function (a) { return { label: a.label, amount: +a.amount }; });
  res.add_total = round2_(res.adds.reduce(function (s, a) { return s + a.amount; }, 0));
  res.deduct_total = round2_(res.deducts.reduce(function (s, a) { return s + a.amount; }, 0));
  res.gross = round2_(res.regular_pay + res.ot_pay + res.add_total);
  res.net = round2_(res.gross - res.deduct_total);
  return res;
}

function empRate_(emp, positions) {
  if (emp.rate_override !== '' && emp.rate_override != null && isFinite(+emp.rate_override)) return +emp.rate_override;
  var p = positions.filter(function (x) { return x.id === emp.position_id; })[0];
  return p ? +p.rate : 0;
}

function apiCalc_(from, to) {
  if (!validDate_(from) || !validDate_(to) || from > to) throw new Error('ช่วงงวดไม่ถูกต้อง');
  var cfg = cfg_(), positions = rows_('Positions');
  var ts = rows_('Timesheets').filter(function (t) { return t.date >= from && t.date <= to; });
  var pending = ts.filter(function (t) { return t.status !== 'approved'; }).length;
  var adjs = apiListAdjustments_(from, to); // ผูกกับ from|to ตรงเป๊ะ
  var out = [];
  rows_('Employees').forEach(function (emp) {
    var days = ts.filter(function (t) { return t.emp_id === emp.id && t.status === 'approved'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var mine = adjs.filter(function (a) { return a.emp_id === emp.id; });
    if (!days.length && !mine.length) return;
    var r = calcEmployee_(emp, empRate_(emp, positions), days, mine, cfg);
    var pos = positions.filter(function (p) { return p.id === emp.position_id; })[0];
    r.position = pos ? pos.name : '';
    r.bank_account = emp.bank_account;
    if (!r.rate) r.errors.push('ยังไม่ได้ตั้งค่าแรง');
    out.push(r);
  });
  return {
    from: from, to: to, pending: pending, rows: out,
    total_net: round2_(out.reduce(function (s, r) { return s + r.net; }, 0)),
    cfg: cfg
  };
}

// ───────────────────────── สลิป ─────────────────────────

function apiIssueSlips_(from, to, empIds) {
  var calc = apiCalc_(from, to);
  var want = {}; (empIds || []).forEach(function (i) { want[i] = 1; });
  var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  var n = 0;
  calc.rows.forEach(function (r) {
    if (!want[r.emp_id]) return;
    if (r.errors.length) throw new Error('พนักงาน ' + r.emp_id + ' ยังมีข้อผิดพลาด: ' + r.errors[0]);
    var snap = { emp_id: r.emp_id, name: r.name, position: r.position, bank_account: r.bank_account, from: from, to: to, row: r };
    var obj = { emp_id: r.emp_id, from: from, to: to, data: JSON.stringify(snap), created: now };
    var ex = rows_('Slips').filter(function (s) { return s.emp_id === r.emp_id && s.from === from && s.to === to; })[0];
    if (ex) { obj.id = ex.id; obj._row = ex._row; update_('Slips', obj); } else { obj.id = newId_(); append_('Slips', obj); }
    n++;
  });
  log_('slips', from + '..' + to + ' x' + n);
  return n;
}
function apiListSlips_(from, to) {
  return rows_('Slips').filter(function (s) { return (!from || s.from === from) && (!to || s.to === to); })
    .sort(function (a, b) { return a.created < b.created ? 1 : -1; })
    .map(function (s) { var d = JSON.parse(s.data); return { id: s.id, emp_id: s.emp_id, name: d.name, from: s.from, to: s.to, net: d.row.net, created: s.created }; });
}
function apiGetSlip_(id) {
  var s = rows_('Slips').filter(function (r) { return r.id === id; })[0];
  if (!s) throw new Error('ไม่พบสลิป');
  return { slip: JSON.parse(s.data), settings: publicSettings_() };
}
function apiLog_() { return rows_('Log').slice(-200).reverse(); }
