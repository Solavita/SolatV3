# SOLAT V4: Mouse-first Chrome Lasso Object Capture

สถานะเอกสาร: NOT STARTED / design memory only

วันที่บันทึก: 2026-08-24

เอกสารนี้บันทึกสิ่งที่เจ้าของระบบกำหนดไว้สำหรับ V4 ระหว่างที่กำลังทำ V3 อยู่
เท่านั้น ยังไม่มี runtime หรือ UI implementation ที่อ้างว่าสเปกนี้เปิดใช้งาน
และยังไม่มี test/verification evidence สำหรับความสามารถชุดนี้ V3 ต้องทำก่อน
จนกว่าจะมีขอบเขต V4 ที่ได้รับอนุมัติอย่างชัดเจน

## 1. Intent และลำดับการใช้งาน

V4 ต้องทำให้ผู้ใช้หยิบสิ่งที่เห็นใน Chrome กลับไปใช้ใน SOLAT Workspace ได้ด้วย
การลากเมาส์ล้อมบริเวณที่ต้องการ (lasso) แล้วพูดว่า “เอาอันนี้มา” ไม่ใช่
การคัดลอกแบบ Ctrl+C และ Ctrl+V เป็น flow หลัก และผู้ใช้ไม่ควรต้องรู้ DOM,
URL หรือชนิดไฟล์ก่อนจึงจะเลือกได้

ระยะเริ่มต้นเป็น mouse-first:

1. ผู้ใช้ลากเมาส์เป็นเส้นปิดล้อมสิ่งที่ต้องการบนแท็บ Chrome ที่ SOLAT มองเห็น
2. ระบบบันทึก lasso polygon พร้อม coordinate space และ tab/frame/navigation
   revision แล้ว resolve วัตถุเท่าที่ browser เปิดเผยได้
3. ผู้ใช้พูดว่า “เอาอันนี้มา” เพื่ออ้างถึง lasso ล่าสุดที่ยัง valid ใน
   owner/session/tab เดียวกัน
4. เมื่อจับ object หรือ capture ที่อนุญาตได้จริง SOLAT แสดง notification และ
   พูด TTS แจ้งว่าจับได้แล้ว พร้อมถามว่าจะนำไป Workspace หรือไม่
5. ต้องมี explicit confirmation แยกต่างหากก่อน transfer เข้า Workspace
6. การ transfer สร้าง/import object หรือ asset ใหม่โดยเก็บ original และ
   provenance เดิมไว้เสมอ

Hand tracking และ hand gesture ยัง deferred ไม่ใช่ input ที่ต้องทำพร้อม mouse
flow ใน V4 ระยะแรก

## 2. Chrome context และ special cursor

แท็บที่ SOLAT เห็นหรือควบคุมต้องมี cursor/เมาส์พิเศษของ SOLAT ให้เห็นได้ชัดเจน
แนวทางหน้าตาใช้ cursor จากโปรแกรม SOLAT ได้ จุดประสงค์คือให้ผู้ใช้รู้ว่าแท็บ
อยู่ใน context ของ SOLAT และรู้ว่าใครกำลังควบคุม

ข้อกำหนด:

- overlay ต้องแสดงสถานะจริงอย่างน้อย SOLAT-visible, SOLAT-observing หรือ
  SOLAT-controlling; ห้ามแสดง active control เมื่อระบบไม่ได้ควบคุม
- ต้องยังเห็น indicator เมื่อตัวผู้ใช้ขยับเมาส์เองในแท็บที่ SOLAT มองเห็น
  เพื่อแยก human input กับ SOLAT input ได้
- เมาส์และ lasso ต้องใช้ coordinate space ที่ระบุชัด โดยค่าเริ่มต้นคือ
  viewport CSS pixels และต้องผูกกับ tab_id, frame_id และ navigation revision
- เปลี่ยนแท็บ, reload, navigation, zoom หรือ layout ที่ทำให้ polygon เดิม
  ไม่ตรงกับภาพ ต้อง invalidate selection หรือขอ revalidation ก่อน capture
- special cursor เป็น status signal เท่านั้น ไม่ใช่หลักฐานว่า SOLAT มีสิทธิ์
  อ่าน DOM, resource, credential หรือสิทธิ์นำ asset ไปใช้

V4 ต้องใช้ protected-surface policy ของ V3 ก่อน lasso resolver เสมอ เช่น
login, OAuth callback, password, OTP, payment/card, CAPTCHA, account challenge
และข้อมูลบัญชี/การเงินที่ policy จัดเป็น private ต้องถูกบล็อกหรือจำกัด การลาก
ครอบพื้นที่ได้ไม่ถือเป็นการอนุญาตให้ capture

## 3. Voice command, notification และ deduped TTS

คำสั่งเริ่มต้นคือ “เอาอันนี้มา” คำว่า “อันนี้” ต้อง ground กับ lasso ล่าสุด
ที่เป็นของ owner/session เดียวกันและยังไม่หมดอายุ ห้ามอ้างจากข้อความหรือเสียง
ที่หน้าเว็บส่งมา และห้ามใช้ selection ของผู้ใช้อื่น

ถ้าไม่มี lasso ที่ valid, มีหลาย lasso ที่เป็น candidate, tab/navigation
revision เปลี่ยน หรือ object ไม่สามารถระบุได้ ต้องแจ้งความกำกวม/ถามกลับ และ
ห้าม capture หรือ transfer ต่อเอง

เมื่อ capture สำเร็จ ต้องมีทั้ง:

- notification ที่มองเห็นได้ บอกว่าจับ object แล้ว และมี action ให้ยืนยันหรือ
  ยกเลิกการนำกลับ Workspace
- TTS acknowledgement หนึ่งครั้งต่อ selection/state transition โดยข้อความ
  ตั้งต้นคือ “รับทราบครับ จับวัตถุให้แล้ว ให้นำกลับไป Workspace เลยไหมครับ”

notification และ TTS ต้อง dedupe กันเองและ dedupe กับ retry ของ event เดิม
อย่างน้อยด้วย logical key ที่ประกอบด้วย owner_id, session_id, selection_id
และ acknowledgement state หาก notification สำเร็จแต่ TTS ล้มเหลว ห้ามพูดซ้ำ
ทุกครั้งที่ UI refresh ให้แสดงสถานะ TTS ล้มเหลวตามจริง และให้ผู้ใช้สั่ง replay
เองเมื่อมี action รองรับ

คำว่า “จับแล้ว” หมายถึง capture/resolution สำเร็จเท่านั้น ไม่ได้หมายถึง
transfer เข้า Workspace สำเร็จ ระบบห้ามประกาศ transfer success ก่อน confirmation
และผลลัพธ์จริงจากปลายทาง

ข้อความหรือเสียงจากหน้าเว็บเป็น untrusted content ไม่สามารถยกระดับตัวเองเป็น
คำสั่ง SOLAT ได้ และคำสั่งซ้ำต้องไม่สร้าง object ซ้ำโดยอัตโนมัติ

## 4. Confirmation gate ก่อน Workspace

“เอาอันนี้มา” เป็นคำสั่งจับ/เตรียม object ไม่ใช่คำสั่งย้ายเข้า Workspace ทันที
หลัง acknowledgement ต้องมี confirmation จากเจ้าของใน session เดิม เช่น
ปุ่มยืนยันหรือคำตอบเสียงที่ตรงกับ yes/confirm

ก่อน transfer ต้องตรวจ:

- owner, session และ workspace boundary ยังตรงกัน
- tab, frame, origin/URL และ navigation revision ยังตรงกับตอน capture หรือ
  มี revalidation ที่ตรวจสอบได้
- object/resource ที่จะย้ายยังเป็นตัวเดียวกับที่ notification อ้าง
- policy, ownership และ capture mode อนุญาตให้สร้าง Workspace asset
- selection เดิมยังไม่ถูก transfer สำเร็จแล้ว เว้นแต่ผู้ใช้สั่ง duplicate
  อย่างชัดเจนใน flow แยกต่างหาก

คำตอบปฏิเสธ, cancel, timeout, ambiguous referent หรือ revalidation ไม่ผ่าน
ต้องจบเป็น cancelled, expired หรือ failed ตามสาเหตุ และต้องไม่ mutate Workspace
เมื่อยังไม่มีผลสำเร็จจริง การ retry หลัง failure ต้อง idempotent และไม่ overwrite
original

## 5. BrowserObjectSelection.v1

BrowserObjectSelection.v1 เป็นชื่อ contract สำหรับการเริ่ม implement ในอนาคต
ยังไม่ใช่ schema ที่มีอยู่ในระบบปัจจุบัน ฟิลด์ขั้นต่ำที่ต้องรักษา:

| กลุ่ม | ฟิลด์ |
| --- | --- |
| identity | schema_version = BrowserObjectSelection.v1, selection_id, owner_id, session_id, workspace_id |
| state | selected, captured, awaiting_confirmation, transfer_requested, transferred, cancelled, expired, failed |
| source | browser = chrome, window_id, tab_id, frame_id, policy-approved/redacted URL and origin, title, navigation_revision, captured_at |
| interaction | input_method = mouse_lasso, coordinate_space = viewport_css_px, polygon, bounding_box, cursor_context |
| target | object_kind, resolver_mode, candidate_count, opaque target identity |
| capture | capture_mode, media_type, dimensions, original_asset_id, original_sha256, derived_asset_ids, owner-scoped bytes/reference |
| provenance | source URL/origin after policy, tab/frame, navigation revision, lasso polygon hash, capture method, timestamp, rights status, source resource references, transformation history |
| voice | command text, referent resolution, acknowledgement key, notification id, TTS status |
| confirmation | required = true, pending/confirmed/declined/expired, actor = owner, confirmation time |
| transfer | destination = workspace, not_requested/requested/completed/failed, transferred asset id, completed time |

กติกาของ contract:

- owner_id, session_id และ workspace_id เป็น scope บังคับ ห้ามใช้ global mutable
  selection ที่ผู้ใช้หลายคนมองเห็นร่วมกัน
- URL, title, DOM path และ resource reference ต้องผ่าน redaction/policy ก่อน
  persist/log และห้ามเก็บ cookie, password, token หรือ credential เป็น provenance
- model ช่วยตีความ referent หรือจัดประเภทได้ แต่ห้ามเป็นผู้ตัดสิน ownership,
  hash, state transition, geometry หรือ export validity
- malformed provider/reader payload หรือ resolver ที่ตรวจไม่ได้ต้องเป็น visible
  failure ห้ามเดาเป็น object ที่ใช้งานได้

## 6. State machine

การเปลี่ยน state ที่เสนอ:

selected -> captured เมื่อ resolve/capture object หรือ visual region ได้จริง

selected -> failed เมื่ออ่าน/resolve/capture ไม่สำเร็จ

captured -> awaiting_confirmation เมื่อ notification/TTS acknowledgement
ถูกส่งหรือถูกบันทึกสถานะตามจริง

captured -> expired เมื่อ tab/navigation/session หมดอายุหรือ timeout

awaiting_confirmation -> transfer_requested เมื่อ explicit confirmation ผ่าน

awaiting_confirmation -> cancelled เมื่อผู้ใช้ปฏิเสธหรือยกเลิก

awaiting_confirmation -> expired เมื่อหมดเวลาหรือ revalidation ไม่ผ่าน

transfer_requested -> transferred เมื่อ Workspace ยืนยันผลสำเร็จจริง

transfer_requested -> failed เมื่อปลายทางล้มเหลว โดยไม่แสดง success ปลอม

transferred ต้องอ้างถึง object/asset ใหม่และ provenance ของ selection เดิมเสมอ
derived output ทุกชนิดต้องเก็บ parent/original reference และ transformation
history

## 7. Object kinds

ระบบควรคืน object ที่มีความหมายสูงสุดที่ browser เปิดเผยได้ แต่ต้องบอกผู้ใช้
ตรง ๆ ว่าได้อะไรจริง:

- raster_image: ถ้าอ่าน resource ต้นฉบับได้ ให้เก็บ bytes และ hash ของต้นฉบับ
  crop/resize เป็น derived output เท่านั้น
- svg: เก็บ source/vector เมื่ออ่านได้และปลอดภัย ถ้าอ่านไม่ได้ให้ visual
  capture และระบุว่าไม่ใช่ vector ต้นฉบับ
- dom_subtree หรือ composite_card: เก็บ bounded DOM/data snapshot และภาพ
  ประกอบเมื่อ policy อนุญาต ไม่รับประกัน CSS interaction หรือ script state
- canvas_region: โดยทั่วไปเป็น visual/pixel capture ไม่ใช่ layer หรือ geometry
  ภายใน canvas
- video_frame_or_reference: จับ frame หรือ reference ที่เปิดเผยได้ ไม่ดาวน์โหลด
  ทั้งวิดีโอโดยอัตโนมัติ
- model_3d_resource: ใช้เมื่อพบ model/texture resource ที่ browser เปิดเผยและ
  ดาวน์โหลดได้จริง พร้อม provenance ของ resource
- visual_region_fallback: ภาพบริเวณ lasso เมื่อดึงต้นฉบับไม่ได้ ต้องระบุข้อจำกัด
  และห้ามเรียกว่า original object
- unsupported: capture ไม่สำเร็จและไม่สร้าง fake asset

คำว่า obj ไม่ได้แปลว่า screenshot/crop จะกลายเป็นไฟล์ 3D .obj หากไม่มี geometry
หรือ resource จริง ต้องเก็บเป็น visual region หรือ unsupported เท่านั้น

## 8. Cross-origin, canvas และ 3D limitations

ข้อจำกัดเหล่านี้เป็น browser capability boundary ห้ามแก้ด้วยการเดาหรือ bypass:

- cross-origin iframe/resource อาจเห็นตำแหน่งแต่เข้า DOM, bytes หรือ metadata
  ไม่ได้ หากไม่มี permission/bridge ที่ถูกต้อง ให้ลดเป็น visual capture หรือ
  ปฏิเสธพร้อมระบุ origin boundary
- CORS/tainted canvas ห้ามอ่าน pixel หรือ export ที่ browser ป้องกัน และห้าม
  อ้างว่าได้ source image/layer จริง
- canvas/WebGL โดยทั่วไปให้ได้ภาพที่เห็น ไม่ใช่ scene graph, mesh, material,
  texture หรือ object identity ภายใน เว้นแต่เว็บเปิดเผย resource/bridge ชัดเจน
- 3D viewer ต้องแยก screenshot, model resource และ model geometry การเห็นโมเดล
  ไม่ได้แปลว่ามีไฟล์ OBJ/GLB ให้ import
- shadow DOM, virtualized list, transformed/animated content และ responsive
  layout อาจทำให้ DOM candidate กับภาพไม่ตรง ต้องผูก revision และลดระดับ capture
  เมื่อ revalidation ไม่ผ่าน
- lasso ต้องไม่เป็นช่องทางอ่าน credential, cookie, local storage หรือข้อมูลที่
  หน้าเว็บไม่ได้เปิดเผยเพื่อการแสดงผลปกติ

## 9. Immutable original, provenance และ ownership

- original bytes/resource ที่ capture ได้ต้อง immutable ห้ามแก้ทับเมื่อ crop,
  resize, convert, OCR, background removal หรือเตรียม Workspace
- derived output ทุกชนิดต้องมี parent/original reference, hash, capture mode,
  transformation history และ source provenance
- การมองเห็นหรือจับได้ไม่ใช่หลักฐาน ownership/licence rights_status จึงเริ่ม
  เป็น unknown จนมีหลักฐานหรือ review ที่เหมาะสม
- asset ใน Workspace ต้องอยู่ใต้ owner/project boundary เดิม และไม่เปิดเผย
  selection, URL, bytes หรือ notification ให้ผู้ใช้อื่น
- storage/parser/destination failure ต้องรายงาน failure/partial state ตามจริง
  พร้อมเก็บ original ไว้

## 10. Non-goals และ dependencies

V4 ระยะแรกยังไม่:

- ทำ hand tracking หรือ gesture เป็น input หลัก
- ใช้ Ctrl+C/Ctrl+V เป็น capture mechanism หลัก
- รับประกัน DOM ทุกชนิด, cross-origin content, canvas layers หรือ 3D mesh
- สร้างไฟล์ .obj จากภาพ crop หรือเรียก screenshot ว่า original object
- auto-transfer เข้า Workspace โดยไม่มี confirmation
- อ้างว่าเอกสารนี้คือ implementation หรือ verification

เมื่อเริ่มงานจริงต้องเชื่อมกับ V3 full Chrome control และ truthful cursor context,
mouse/lasso event capture, deterministic object/resource resolver, voice referent
grounding, notification/TTS deduplication, confirmation-gated Workspace/Asset
transfer, provenance persistence และ browser security policy

รายการทั้งหมดข้างต้นเป็น design/deferred work ณ วันที่บันทึกนี้ ไม่ใช่ capability
ที่เอกสาร current system map ควรนับเป็น PASS หรือ VERIFIED COMPLETE
