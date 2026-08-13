# SOLAT V2 shared domain contracts

> Current correction (2026-08-11): the earlier milestone notes below are historical.
> The current deterministic suite is `npm.cmd test` PASS (34/34), the immutable
> original-asset adapter is connected, and the editable HTML export path is now
> covered by `src/core/exporter.js` and secure IPC. Export opening, visual fidelity,
> and cross-process persistence remain `NOT VERIFIED` until runtime review.

สถานะส่วนนี้: `IMPLEMENTED BUT NOT FULLY VERIFIED`

ไฟล์ `src/core/contracts.js` เป็นสัญญาข้อมูลกลางของ V2 ตามแนวคิดใน Master Specification v3.0 โดยไม่ผูกกับ UI หรือผู้ให้บริการโมเดล สัญญาทั้งหมดตรวจข้อมูลตั้งแต่ตอนสร้าง, มี `schema_version`, timestamp และคืนค่าแบบ immutable เพื่อให้การแก้ไขเป็น revision ใหม่แทนการแก้ทับ object เดิม

## สัญญาที่มีอยู่

- `Project` — ownership/session boundary, revision, สถานะโครงการ, references ไปยัง brief/emotion/narrative/design/document/assets/jobs และ retention state
- `CreativeBrief` — เป้าหมาย กลุ่มผู้ชม แหล่งเนื้อหา ข้อจำกัด ความต้องการ output user locks และ risk flags
- `EmotionProfile` — Emotion DNA รุ่น `2.0`, confidence, field provenance, user locks, uncertainty, influence และ temporal arc
- `NarrativePlan` — เป้าหมายการสื่อสารของแต่ละสไลด์ คำถามของผู้ชม หลักฐาน บทบาททางอารมณ์ layout family และข้อจำกัด
- `DesignSystem` — tokens, rules, accessibility และ grammar ของโครงการ
- `CreativeDocument` — เอกสารแก้ไขได้ที่มี slide/element IDs และ element types ที่ตรวจสอบได้
- `Asset` — original/derived/generated class, owner, hash, parent, transformations, permissions และ immutable-original flag
- `Job` — idempotency key, explicit status, attempts/retry budget, structured errors, outputs และ trace ID
- `QualityReport` — findings, repairs, warnings, evidence และ `human_review_required`

## State และ safety rules

- `transitionProject` และ `transitionJob` อนุญาตเฉพาะเส้นทางที่ประกาศไว้
- `SUCCEEDED` ของ job ต้องมี output อย่างน้อยหนึ่งรายการ
- failed job ต้องมี structured error; retryable กับ terminal แยกกัน
- retry จะไม่เกิดเอง และ retry budget เป็นค่าที่ตรวจได้
- original asset จะถูกระบุ immutable และ derived asset ต้องระบุ parent/transformations
- ความสำเร็จเชิงคุณภาพยังไม่ถูกอ้างจากสัญญาเพียงอย่างเดียว เพราะ `QualityReport.human_review_required` เริ่มต้นเป็น `true`

## การเชื่อมกับเส้นทางจริง

`SessionWorkspace` ถูกใช้โดย `ConversationCore` แล้ว แต่ละข้อความมี project/job/trace ID, request ID สำหรับ idempotency, การ replay ของ job ที่สำเร็จ และ failure state ที่เก็บไว้โดยไม่บันทึกข้อความสำเร็จปลอมลงใน history

หลักฐาน deterministic ปัจจุบัน: `npm.cmd run check` ผ่าน และ `npm.cmd test` ผ่าน
34/34 รวมการตรวจ ownership, immutability, provenance, state transition,
missing-output failure, idempotency, truthful failure, provider V4 request shaping,
workflow, export, search และ UI contract

ข้อจำกัดที่ยังเหลือ: contract layer ต่อเข้ากับ Music-to-Deck, editable HTML
export, search boundary และ original-asset storage แล้ว แต่ยังไม่มีหลักฐานว่า
flagship workflow ครบทั้งเส้นทางหรือมีคุณภาพตามมนุษย์ประเมิน
