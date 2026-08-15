const fs = require('node:fs');
const path = require('node:path');

const output = 'D:/SOLAT_V3/evaluations/followup-context-100.json';
const categories = [
  ['context_pronouns', ['มัน', 'เขา', 'อันนั้น', 'แบบเดิม', 'คนแรก']],
  ['thai_english_mixed', ['สรุป', 'compare', 'latest', 'แปล', 'source']],
  ['typo_spacing_romanization', ['ParkDayoung', 'p ark dayoung', 'ฮันนารี', 'han nari', 'ค้น ห า']],
  ['corrections', ['แก้เป็นชื่อแรก', 'ไม่ใช่คนเดิม', 'ใช้ข้อมูลล่าสุด', 'ตัดข้อสอง', 'เปลี่ยนภาษา']],
  ['multi_step_constraints', ['หนึ่ง', 'สอง', 'สาม', 'ตามลำดับ', 'ห้ามแต่งข้อมูล']],
  ['tool_no_tool', ['ค้นหา', 'ไม่ต้องค้น', 'อ่านหน้านี้', 'สรุปจากข้อความ', 'เลือก tool']],
  ['grounding_unknown', ['หลักฐาน', 'ไม่ทราบ', 'อ้างอิง', 'แยก fact', 'ยืนยัน']],
  ['failure_handling', ['timeout', 'malformed', 'ล้มเหลว', 'retry', 'หยุดเมื่อเกิน limit']],
  ['entity_resolution', ['ตัวละคร', 'นักร้อง', 'สินค้า A', 'ลูกค้าคนแรก', 'ออเดอร์ล่าสุด']],
  ['consistency_followup', ['ทำแบบเดิม', 'สั้นลง', 'ขยายข้อสาม', 'คงรูปแบบ', 'ตรวจซ้ำ']],
];

const seedFor = (category, term, marker, index) => {
  switch (category) {
    case 'context_pronouns': return `ช่วยจำไว้ก่อนว่าเคสนี้พูดถึง “${term}” สำหรับรายการที่ ${index} (${marker})`;
    case 'thai_english_mixed': return `For this case (${marker}), please keep the subject “${term}” and answer in the requested mixed language.`;
    case 'typo_spacing_romanization': return `ฉันกำลังค้นชื่อ “${term}” ในเคส ${marker}; อย่าแก้ชื่อเองจนกว่าจะมีหลักฐาน`;
    case 'corrections': return `ข้อมูลตั้งต้นของเคส ${marker} คือ “${term}”; ถ้าฉันแก้ไขภายหลังให้ยึดข้อความล่าสุด`;
    case 'multi_step_constraints': return `เคส ${marker} ต้องทำงานเป็นขั้น โดยมีเงื่อนไขเรื่อง “${term}” และห้ามข้ามลำดับ`;
    case 'tool_no_tool': return `เคส ${marker} มีคำขอเกี่ยวกับ “${term}”; ให้ตัดสินจากขอบเขตงานว่าต้องใช้ tool หรือไม่`;
    case 'grounding_unknown': return `สำหรับเคส ${marker} ให้แยก fact กับสิ่งที่ยังไม่รู้เมื่อพูดถึง “${term}”`;
    case 'failure_handling': return `เคส ${marker} จำลองสถานการณ์ “${term}”; ถ้าเกิดปัญหาให้รายงานสถานะจริงและหยุดตามขีดจำกัด`;
    case 'entity_resolution': return `ในเคส ${marker} คำว่า “${term}” คือเอนทิตีที่ต้องติดตามต่อ ห้ามปนกับชื่ออื่น`;
    default: return `เคส ${marker} กำหนดรูปแบบคำตอบเกี่ยวกับ “${term}” ไว้ก่อน`;
  }
};
const followupFor = (category, term, index) => {
  switch (category) {
    case 'context_pronouns': return `ต่อจากข้อความก่อนหน้า (รายการ ${index}) ช่วยอธิบายว่า “${term}” หมายถึงอะไรในบริบทนี้`;
    case 'thai_english_mixed': return `Now follow up for item ${index}: ${term} — give the answer with the same language preference and scope.`;
    case 'typo_spacing_romanization': return `ช่วยตรวจคำค้น “${term}” ต่อในรายการ ${index} โดยเสนอการสะกดที่เป็นไปได้แต่ไม่ฟันธงตัวตน`;
    case 'corrections': return `แก้คำขอของฉันในรายการ ${index} ตามนี้: “${term}” และบอกว่าข้อมูลส่วนใดถูกเปลี่ยน`;
    case 'multi_step_constraints': return `ทำขั้น “${term}” ของรายการ ${index} ต่อจากงานเดิมตามลำดับ และระบุขั้นที่ยังทำไม่ได้`;
    case 'tool_no_tool': return `จากบริบทเดิมของรายการ ${index} ขอให้จัดการ “${term}” และบอกเหตุผลว่าจะใช้หรือไม่ใช้ tool`;
    case 'grounding_unknown': return `สรุปรายการ ${index} เรื่อง “${term}” โดยใส่หลักฐานที่มี แยก inference และบอกสิ่งที่ยืนยันไม่ได้`;
    case 'failure_handling': return `ดำเนินการรายการ ${index} ต่อกับ “${term}” แต่ห้ามรายงานสำเร็จหากยังไม่มีผลตรวจจริง`;
    case 'entity_resolution': return `ต่อจากเอนทิตีเดิมของรายการ ${index} ช่วยตอบเรื่อง “${term}” โดยอธิบายความกำกวมถ้ามี`;
    default: return `ทำรายการ ${index} เรื่อง “${term}” ต่อโดยคงรูปแบบและข้อจำกัดจากข้อความก่อนหน้า`;
  }
};

const cases = [];
for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
  const [category, terms] = categories[categoryIndex];
  for (let offset = 0; offset < 10; offset += 1) {
    const n = categoryIndex * 10 + offset;
    const id = `followup100_${String(n).padStart(3, '0')}_${category}`;
    const marker = `FU100-${String(n).padStart(3, '0')}`;
    const term = terms[offset % terms.length];
    const history = [{ role: 'user', content: seedFor(category, term, marker, n) }];
    if (category === 'context_pronouns' && offset >= 8) {
      history.push({ role: 'user', content: `รายละเอียดเพิ่มเติมของรายการ ${n}: ${'ข้อมูลประกอบที่ผู้ใช้ให้ไว้ก่อนหน้านี้ควรคงอยู่เพื่อใช้แก้คำอ้างอิงและไม่ควรตัดบริบทล่าสุดออก '.repeat(24)}` });
    }
    cases.push({
      id, category,
      history,
      content: followupFor(category, term, n),
      expected_behavior: ['resolve_followup_against_case_history', 'preserve_case_scope', 'answer_in_requested_language_or_style', 'state_unknowns_without_invention'],
      forbidden_behavior: ['use_context_from_another_case', 'invent_evidence', 'claim_tool_success_without_evidence', 'ignore_latest_correction'],
      case_marker: marker,
    });
  }
}

const corpus = { schema_version: 'solat.followup-context-corpus.v1', case_count: cases.length, purpose: 'Supplemental follow-up benchmark with real user seed turns; does not alter the original fixed 100-case corpus.', cases };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(corpus, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ output, case_count: cases.length }, null, 2));
