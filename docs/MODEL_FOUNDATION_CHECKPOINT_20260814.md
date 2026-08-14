# Model Foundation checkpoint — 2026-08-14

สถานะรวม: `IMPLEMENTED BUT NOT FULLY VERIFIED`

ขอบเขตของ checkpoint นี้คือ model foundation, prompt/context hints, tool selection และ evaluation เท่านั้น ไม่รวม Phase 0–4, Business Context, Commerce MVP หรือ provider แบบเสียเงิน

## ฐานที่ตรวจ

- Workspace: `D:\SOLAT_V3`
- Branch: `phase-0-4`
- Base history ที่แยกงาน foundation ได้: `584b8ad` (`main`, Add SolatV3 desktop application source)
- Current branch head ก่อน checkpoint: `8b224c8` (`Record desktop intake boundary smoke`)
- Working-tree changes ที่มีอยู่ก่อนงานนี้: `test/ui.test.js` และ `test/fixtures/SolatUI.html` (แก้เพื่อให้ชุดทดสอบรันได้จาก D โดยไม่เปลี่ยน runtime behavior)

## สิ่งที่ตรวจและเพิ่ม

- ตรวจ `src/core/intent-router.js`, `conversation-core.js`, `conversation-evaluator.js`, `provider.js` และ `web-search.js`
- เพิ่ม `evaluations/model-foundation-benchmark-v1.json` เป็นชุด 10 หมวด: multi-step, context/follow-up, Thai, typo/entity, ambiguity, fact/inference/unknown, insufficient evidence, tool choice, tool failure และ repeatability
- เพิ่ม `test/model-foundation.test.js` เพื่อยืนยัน schema, หมวดครบ และผล deterministic ที่ทำซ้ำได้
- ไม่มีการเรียก DeepSeek/RunPod/Qwen/Brave หรือ paid provider ใน checkpoint นี้

## GitHub reference ที่ตรวจ

- `openai/openai-agents-python` — MIT; ใช้เป็น reference เรื่อง context/tool metadata เท่านั้น ไม่ได้ copy หรือเพิ่ม dependency
- `deepset-ai/fastapi-openai-compat` — Apache-2.0; ใช้เป็น reference เรื่อง OpenAI-compatible tool-call boundary เท่านั้น ไม่ได้เพิ่ม dependency
- `antoinezambelli/forge` — มี README และ guardrail/tool-loop แนวคิดที่เกี่ยวข้อง แต่ license ไม่ได้รับการยืนยันชัดพอ จึงไม่ได้นำโค้ดหรือ dependency มาใช้

## ผลตรวจจริง

คำสั่งที่ต้องรันจาก D:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run evaluate:conversation
```

ชุด deterministic ใหม่คาดหวังผล `PASS 4 / FAIL 0 / NOT VERIFIED 1` ในตัวอย่างที่เลือก และตั้งใจไม่แปลง semantic parity เป็นคะแนนอัตโนมัติ

## ข้อจำกัด / สิ่งที่ยังไม่ผ่าน

- คำตอบเชิงความหมายและความใกล้เคียง ChatGPT ยัง `NOT VERIFIED`; ต้องมี baseline ที่จับคู่และ manual review จริง
- ยังไม่ได้ทดสอบ provider สดหรือ search สดตามขอบเขต local/free
- benchmark ใหม่เป็น contract/evidence harness ไม่ใช่หลักฐานว่า model ฉลาดขึ้น
- งานธุรกิจและ Phase 0–4 ถูกพักไว้ตามคำสั่งล่าสุด
