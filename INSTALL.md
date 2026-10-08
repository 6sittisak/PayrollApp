# ติดตั้งแบบไม่ใช้ clasp (ก๊อปวางในเบราว์เซอร์ ~10 นาที)

ทำด้วยบัญชี **6.sittisak@gmail.com** (บัญชีนี้จะเป็นเจ้าของข้อมูลเงินเดือน)

## 1) สร้างโปรเจกต์และวางโค้ด
1. เปิด https://script.google.com → **New project** → ตั้งชื่อ "ระบบเงินเดือน"
2. ไฟล์ `Code.gs` ที่มีอยู่แล้ว → ลบของเดิมทิ้ง แล้ววางเนื้อหาจาก `Code.gs` ในรีโปนี้
3. กด **+** ข้าง Files → **Script** → ตั้งชื่อ `TimesheetOcr` → วางเนื้อหาจาก `TimesheetOcr.gs`
4. กด **+** → **HTML** → ตั้งชื่อ `Index` → วางเนื้อหาจาก `Index.html`
5. ⚙ **Project Settings** → ติ๊ก **Show "appsscript.json" manifest file** → กลับไป Editor เปิด `appsscript.json` → วางเนื้อหาจากไฟล์ `appsscript.json` ในรีโป → Save
6. ⚙ Project Settings → **Script Properties** → Add: `APP_PIN` = รหัสผ่านที่ต้องการ (**ต้องตั้ง** ไม่งั้นใครมีลิงก์ก็เห็นเงินเดือน)

## 2) ติดตั้งข้อมูล
1. Editor → เลือกฟังก์ชัน **setup** → **Run** → Review permissions → เลือกบัญชี → *Advanced → Go to ระบบเงินเดือน (unsafe)* → Allow
   (เตือนนี้ปกติ เพราะเป็นสคริปต์ของเราเอง ไม่ได้ผ่านการตรวจของ Google)
2. ดู Execution log ต้องขึ้น "พร้อมใช้งาน สเปรดชีต: ..." และใน Drive มีโฟลเดอร์ `Payroll_System`

## 3) Deploy เป็นเว็บ
**Deploy → New deployment → ⚙ Web app** → Execute as: **Me** · Who has access: **Anyone** → Deploy → คัดลอก URL `/exec`
(แก้โค้ดภายหลัง: Deploy → **Manage deployments** → ✏ → Version: New version → Deploy เพื่อให้ URL เดิม)

## 4) ใช้งานครั้งแรก
เปิด URL → ใส่ APP_PIN → ระบบพาไป **ตั้งค่าระบบ**: ชื่อบริษัท, โลโก้, กติกาคำนวณ → เพิ่มตำแหน่งงาน → พนักงาน → บันทึกเวลา

## 5) ทดสอบเทียบคิดมือ (ก่อนใช้จ่ายจริง)
ตำแหน่ง ค่าแรง 100/ชม. · พนักงาน 1 คน · ลงเวลา 09:00–18:30 พัก 60 นาที
→ ต้องได้ ปกติ 8 ชม. = 800.00 · OT 0.5 ชม. ×1.5 = 75.00 · รวม 875.00 (ถ้าเพิ่มเบี้ยขยัน 200 = 1,075.00)

## 6) (ไม่บังคับ) AI อ่านใบลงเวลา
1. https://aistudio.google.com/apikey → **Create API key** → สร้างในโปรเจกต์ **ใหม่**
2. Script Properties → `GEMINI_API_KEY` = คีย์ (หลายคีย์คั่น `,`)
3. เว็บ → ตั้งค่าระบบ → **ทดสอบคีย์ AI** ต้องขึ้น ✓
   - ถ้าขึ้น 403 "denied access" = Google ระงับโปรเจกต์ที่ออกคีย์ → สร้างใหม่ในโปรเจกต์ใหม่

## 7) (ไม่บังคับ) บอท LINE
Editor → Run **setupBotSecret** → Execution log จะแสดง `BOT_SECRET` (แสดงครั้งเดียว) → นำไปตั้งฝั่งบอท
ผูกพนักงานด้วยช่อง "LINE user id" ที่เมนูพนักงาน
