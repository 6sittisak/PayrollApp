# ระบบเงินเดือนพนักงานรายชั่วโมง (Google Apps Script)

ขอบเขต: พนักงานรายชั่วโมง/Part-time — ค่าแรง + OT + ปรับเงิน (เพิ่ม/หัก) + สลิป
**ยังไม่มี:** ประกันสังคม, ภาษีหัก ณ ที่จ่าย, กะข้ามเที่ยงคืน

> สถานะ: โค้ดเขียนใหม่ ผ่านชุดทดสอบบน Node (ตัวจำลอง Apps Script) แต่ **ยังไม่เคยรันบน Apps Script จริง**
> ให้ทดสอบบนเว็บจริงด้วยงวดตัวอย่าง 1 คน เทียบกับคิดมือก่อนใช้จ่ายเงินจริง

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `Code.gs` | เซิร์ฟเวอร์: ชีต/โฟลเดอร์, API, คำนวณ, สลิป, โลโก้, `doPost` จากบอท LINE |
| `TimesheetOcr.gs` | AI (Gemini) อ่านรูปใบลงเวลา ฟอร์ม `PAY-TS` |
| `Index.html` | หน้าเว็บทั้งระบบ (11 เมนู) |
| `appsscript.json` | manifest (Bangkok, V8, เปิดไม่ต้องล็อกอิน, รันสิทธิ์เจ้าของ) |
| `tests/test-core.js` | สูตรคำนวณ + การเรียก Gemini + ความปลอดภัยของ dispatcher |
| `tests/ui-smoke.js` | หน้าเว็บ + Code.gs จริง ในเบราว์เซอร์ (Playwright) 19 จุด รวมรหัสผ่าน |

## ติดตั้ง
ไม่อยากใช้ clasp → ดู [INSTALL.md](INSTALL.md) (ก๊อปวางในเบราว์เซอร์)

**ตั้ง Script Property `APP_PIN` ทุกครั้ง** — เว็บเปิดแบบไม่ต้องล็อกอิน ถ้าไม่ตั้งใครมีลิงก์ก็เห็นเงินเดือนได้ (ผิด 5 ครั้งล็อก 10 นาทีทั้งระบบ)

```bash
node tests/test-core.js                      # ต้อง PASS
cp appsscript.json appsscript.json.bak       # create-script เขียนทับ manifest
npx clasp create-script --type standalone --title "ระบบเงินเดือน"
cp appsscript.json.bak appsscript.json
npx clasp push -f                            # ต้องเห็น "Pushed 4 files"
npx clasp create-deployment -d "ติดตั้งครั้งแรก"   # เก็บ deploymentId ไว้ redeploy ทับ URL เดิม (-i)
```
1. เจ้าของบัญชีเปิดเอดิเตอร์ → Run `setup` → กดอนุญาตสิทธิ์ (ก่อนนี้ /exec ตอบ 403) — สร้างโฟลเดอร์ `Payroll_System` + สเปรดชีต
2. เปิด URL /exec → ไปหน้า **ตั้งค่าระบบ** → ชื่อบริษัท, โลโก้, กติกาคำนวณ
3. ตำแหน่งงาน → พนักงาน → บันทึกเวลา → คำนวณ → ออกสลิป
4. AI อ่านใบลงเวลา: สร้างคีย์ที่ https://aistudio.google.com/apikey (โปรเจกต์ใหม่) → Script Properties `GEMINI_API_KEY` → ตั้งค่าระบบ → **ทดสอบคีย์ AI**
5. บอท LINE: Run `setupBotSecret` → เอารหัสจาก Execution log ไปตั้งฝั่งบอท · ผูกพนักงานด้วยช่อง "LINE user id" ที่เมนูพนักงาน
   - `POST /exec` body JSON: `{"secret","lineUserId","action":"slip"|"ocr","from?","to?","image?"}`

## กติกาคำนวณ
- นาทีทำงาน = ออก − เข้า − พัก ; พักว่างหรือ 0 = หักตามค่าตั้งต้น
- ปกติไม่เกิน `normal_hours`/วัน ส่วนเกิน = OT × `ot_multiplier`
- OT น้อยกว่า `ot_min_minutes` = 0 (เท่ากับขั้นต่ำพอดี = นับ) — ตั้ง 0 = นับทุกนาที
- นับเฉพาะใบลงเวลาสถานะ "อนุมัติ" · ปรับเงินผูกกับช่วงวันที่ตรงเป๊ะ
