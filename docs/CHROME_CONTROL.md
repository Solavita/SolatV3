# SOLAT Chrome Control

สถานะ: `IMPLEMENTED BUT NOT FULLY VERIFIED`

SOLAT Chrome Control เป็นส่วนขยาย Manifest V3 และ local bridge ที่ทำให้ Agent ใช้
Chrome โปรไฟล์ปกติของเจ้าของได้ โดยหน้าเว็บยังแสดงและควบคุมด้วย Chrome จริง
หากยังไม่ได้เชื่อมส่วนขยาย SOLAT จะใช้ Browser Workspace แบบ isolated เดิม
เป็น fallback โดยอัตโนมัติ

## ตั้งค่าครั้งแรก

1. เปิด Command Palette ใน SOLAT แล้วเลือก `Chrome Control setup`.
2. กด `Open extension folder`.
3. เปิด `chrome://extensions` ใน Chrome, เปิด Developer mode, เลือก
   `Load unpacked` แล้วเลือกโฟลเดอร์ที่ SOLAT เปิดให้.
4. กลับมาหน้าตั้งค่าและกด `Pair Chrome` จากนั้นเปิด popup ของส่วนขยายเพื่อดูสถานะ.
5. เมื่อเชื่อมแล้ว กล่องตั้งค่าจะแสดงแท็บจาก Chrome ทุก normal window; กด
   `Switch` เพื่อเปลี่ยนไปยังแท็บปกติ หรือใช้ `Use current Chrome tab` เพื่อรับ
   แท็บที่กำลังเปิดอยู่ทันที.

การ pair ต้องเกิดจากการกดของเจ้าของเท่านั้น SOLAT ไม่ติดตั้ง extension และไม่เปิด
สิทธิ์นี้เอง Token สำหรับ local bridge เก็บในโปรไฟล์ของระบบและส่งเฉพาะระหว่าง SOLAT
กับ extension ID ที่ระบุบน `127.0.0.1`; หน้า status, renderer และ log จะไม่เห็น token.

## ขอบเขตความเป็นส่วนตัว

- หน้า login, OAuth, challenge, CAPTCHA, payment และหน้าที่มี password/OTP/card
  จะเข้า privacy shield ทั้งหน้า
- เมื่อ shield ทำงาน Agent จะอ่าน DOM, ถ่ายภาพ, กด, กรอก หรือดึงรูปจากหน้านั้นไม่ได้
- เจ้าของเป็นผู้กรอกรหัส รหัสครั้งเดียว การยืนยันตัวตน และการชำระเงินใน Chrome เอง
- เมื่อออกจากหน้าส่วนตัว เจ้าของสามารถสั่ง `Use current Chrome tab` อีกครั้งเพื่อให้
  Agent ทำงานต่อบนหน้าปกติที่ล็อกอินแล้ว
- เนื้อหาจากเว็บเป็นข้อมูลที่ไม่น่าเชื่อถือ ไม่ใช่คำสั่งของระบบ
- รายการแท็บส่ง raw Chrome tab id ให้ Agent ไม่ได้ แต่ใช้ opaque `tab_ref` ที่ผูก
  owner/session แทน หน้า shielded/unsupported ไม่ส่ง URL หรือ title ให้ SOLAT
- การอ่านรายการแบ่งเป็นหน้าละ 100 และรวมได้สูงสุด 1,000 แท็บต่อครั้ง หากเกิน
  ระบบคืน `truncated: true` ตามจริงแทนการทำงานแบบไม่จำกัด

## Full Chrome Control ใน V3

- Agent มี read tool สำหรับดูรายการแท็บ และ write tool แยกต่างหากสำหรับสลับแท็บ
- การสลับแท็บต้องอ้าง `tab_ref` จากรายการล่าสุดและผ่าน approval boundary เดิม
- แท็บปกติที่ extension เชื่อมอยู่แสดง cursor/ป้าย `SOLAT CONTROL`; เมื่อ disconnect
  หรือหน้าเปลี่ยนเป็น private indicator จะถูกถอดและคืน cursor ปกติ
- Chrome internal pages, incognito, login/OAuth, password/OTP, payment/CAPTCHA และ
  account challenge ยังคง human-only

## การใช้รูปกับ SpatialAsset

บนหน้าปกติที่ไม่ถูก privacy shield ให้กด `Alt` พร้อมคลิกรูป ส่วนขยายจะส่งเฉพาะ
ไบต์ของรูปที่เลือกผ่าน local bridge ที่มีขนาดจำกัดเข้าสู่ V4 SpatialAsset เดิม
ต้นฉบับบนเว็บไม่ถูกแก้ไขและ asset ที่ SOLAT รับจะรักษา provenance ตามสัญญาเดิม.

## ข้อจำกัดการตรวจสอบ

Automated tests ตรวจ pairing, owner/session isolation, stale target, privacy shield,
ขนาดข้อมูล และ fallback ได้โดยไม่ใช้บัญชีจริง แต่การติดตั้ง extension, signed-in site,
Google login, CAPTCHA และการลากรูปจริงเป็น `MANUAL REVIEW REQUIRED`.
V4 mouse-lasso/object capture ยังเป็น `NOT STARTED`; ดู
`docs/V4_MOUSE_LASSO_OBJECT_SPEC.md` ซึ่งเป็น design memory เท่านั้น.
