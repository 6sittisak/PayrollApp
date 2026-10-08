/**
 * AI อ่านรูปใบลงเวลาฟอร์ม PAY-TS ด้วย Gemini
 * ตั้งคีย์ที่ Project Settings → Script Properties → GEMINI_API_KEY (หลายคีย์คั่น ",")
 * รุ่นตั้งต้น gemini-3.5-flash → ถอยไป gemini-2.5-flash ; เปลี่ยนรุ่นด้วย Script Property GEMINI_MODEL
 * รหัสฟอร์ม "PAY-TS" ใช้ทั้งใน prompt นี้และหน้า "พิมพ์ใบลงเวลา" ใน Index.html — เปลี่ยนต้องเปลี่ยนคู่กัน
 */

var GEMINI_BASE_ = 'https://generativelanguage.googleapis.com/v1beta/models/';
var GEMINI_DEFAULT_MODELS_ = ['gemini-3.5-flash', 'gemini-2.5-flash'];

function geminiKeys_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  return raw.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
}
function geminiModels_() {
  var custom = (PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || '').trim();
  var list = custom ? [custom].concat(GEMINI_DEFAULT_MODELS_) : GEMINI_DEFAULT_MODELS_.slice();
  return list.filter(function (m, i) { return list.indexOf(m) === i; });
}

/** ลบคีย์ออกจากข้อความก่อนแสดง/บันทึก — กันคีย์หลุดเข้า log หรือหน้าเว็บ */
function scrub_(s) {
  var out = String(s || '').replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[key]');
  geminiKeysSafe_().forEach(function (k) { if (k.length > 8) out = out.split(k).join('[key]'); });
  return out;
}
function geminiKeysSafe_() { try { return geminiKeys_(); } catch (e) { return []; } }

function geminiErrMsg_(body) {
  try { var j = JSON.parse(body); if (j.error && j.error.message) return String(j.error.message); } catch (e) { }
  return String(body || '').slice(0, 200);
}

/** คืน {text, model} ; ลองทีละคีย์ × ทีละรุ่น ; ปัญหาระดับคีย์/โปรเจกต์ → ข้ามไปคีย์ถัดไป */
function geminiGenerate_(parts, asJson) {
  var keys = geminiKeys_();
  if (!keys.length) throw new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY (Project Settings → Script Properties) — กรอกเวลาเองได้ที่เมนูบันทึกเวลา');
  var models = geminiModels_(), lastErr = 'เรียก AI ไม่สำเร็จ';
  for (var k = 0; k < keys.length; k++) {
    for (var m = 0; m < models.length; m++) {
      var payload = { contents: [{ parts: parts }], generationConfig: { temperature: 0 } };
      if (asJson) payload.generationConfig.responseMimeType = 'application/json';
      var res;
      try {
        res = UrlFetchApp.fetch(GEMINI_BASE_ + models[m] + ':generateContent', {
          method: 'post', contentType: 'application/json',
          headers: { 'x-goog-api-key': keys[k] }, // คีย์อยู่ใน header ไม่อยู่ใน URL
          payload: JSON.stringify(payload), muteHttpExceptions: true
        });
      } catch (e) { lastErr = 'ต่อ Google ไม่ได้: ' + scrub_(e && e.message); continue; }
      var code = res.getResponseCode(), body = res.getContentText();
      if (code === 200) {
        var text = '';
        try { text = JSON.parse(body).candidates[0].content.parts[0].text || ''; } catch (e) { }
        if (text) return { text: text, model: models[m] };
        lastErr = 'AI ไม่ตอบกลับ (' + models[m] + ')';
        continue;
      }
      var msg = scrub_(geminiErrMsg_(body));
      lastErr = 'Google ' + code + ': ' + msg;
      if (/denied access/i.test(msg)) {
        lastErr += ' — Google ระงับทั้งโปรเจกต์ที่ออกคีย์นี้ ต้องสร้างคีย์ใหม่ในโปรเจกต์ใหม่';
        break;
      }
      if (code === 401 || /API key/i.test(msg)) break; // คีย์ผิด/หมดอายุ → ไม่ต้องลองรุ่นอื่นด้วยคีย์เดิม
      // 404/403/429/5xx อื่นๆ → ลองรุ่นถัดไป
    }
  }
  throw new Error(lastErr);
}

function apiTestKey_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('keytest')) throw new Error('รอ 30 วินาที แล้วกดทดสอบใหม่'); // เว็บเปิดไม่ต้องล็อกอิน → จำกัดทั้งระบบ
  cache.put('keytest', '1', 30);
  var r = geminiGenerate_([{ text: 'ตอบสั้นๆ ว่า OK' }], false);
  return { ok: true, model: r.model };
}

var OCR_PROMPT_ = [
  'นี่คือรูปใบลงเวลาแบบฟอร์ม PAY-TS (ตารางวันที่ / เวลาเข้า / เวลาออก / พัก(นาที) / หมายเหตุ).',
  'อ่านทุกแถวที่มีการกรอกเวลา แล้วตอบเป็น JSON array เท่านั้น แต่ละรายการมีฟิลด์:',
  '{"date":"YYYY-MM-DD","time_in":"HH:mm","time_out":"HH:mm","break_min":number,"note":string}',
  'กติกา: ถ้าปีเป็น พ.ศ. ให้แปลงเป็น ค.ศ. ; เวลาใช้ 24 ชั่วโมง ; ช่องพักว่างให้ใส่ 0 ;',
  'แถวที่ไม่มีเวลาเข้า-ออกให้ข้าม ; ห้ามเดาตัวเลขที่อ่านไม่ออก — ให้ข้ามแถวนั้น.'
].join('\n');

/** แปลงผลจาก AI ให้เป็นแถวมาตรฐาน (คืน rows ที่ผ่านตรวจ + skipped ที่อ่านไม่ได้) */
function normalizeOcr_(arr) {
  var rows = [], skipped = 0;
  (Array.isArray(arr) ? arr : []).forEach(function (r) {
    var date = txt_(r && r.date);
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(date); // d/m/y → y-m-d
    if (m) date = m[3] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[1]);
    var y = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (y && +y[1] > 2400) date = (+y[1] - 543) + '-' + y[2] + '-' + y[3]; // พ.ศ. → ค.ศ.
    var a = parseHM_(r && r.time_in), b = parseHM_(r && r.time_out);
    if (!validDate_(date) || a == null || b == null || b <= a) { skipped++; return; }
    var brk = parseInt(r.break_min, 10);
    rows.push({ date: date, time_in: fmtHM_(a), time_out: fmtHM_(b), break_min: isFinite(brk) && brk > 0 && brk <= 600 ? brk : 0, note: txt_(r.note).slice(0, 200) });
  });
  return { rows: rows, skipped: skipped };
}

function ocrImage_(dataUrl) {
  var img = decodeDataUrl_(dataUrl, 6 * 1024 * 1024);
  var r = geminiGenerate_([{ text: OCR_PROMPT_ }, { inline_data: { mime_type: img.mime, data: img.b64 } }], true);
  var parsed;
  try { parsed = JSON.parse(r.text); } catch (e) { throw new Error('AI ตอบกลับในรูปแบบที่อ่านไม่ได้ ลองถ่ายรูปใหม่ให้ชัดขึ้น'); }
  var n = normalizeOcr_(parsed);
  if (!n.rows.length) throw new Error('ไม่พบแถวเวลาที่อ่านได้ในรูป');
  return { rows: n.rows, skipped: n.skipped, model: r.model };
}

function apiOcr_(dataUrl) {
  var res = ocrImage_(dataUrl);
  log_('ocr', res.rows.length + ' แถว (' + res.model + ') ข้าม ' + res.skipped);
  return res; // ส่งให้คนตรวจในหน้าเว็บก่อนบันทึก ไม่เขียนชีตเอง
}
