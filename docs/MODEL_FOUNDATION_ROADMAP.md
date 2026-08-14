# Model Foundation roadmap

สถานะ ณ 2026-08-14: `IMPLEMENTED BUT NOT FULLY VERIFIED`

ลำดับนี้เป็นขอบเขตที่พักไว้ก่อน Phase 0–4 และฟีเจอร์ธุรกิจ

| Priority | Work item | Current evidence | Next gate |
|---|---|---|---|
| 1 | Context/follow-up/entity resolution | Router preserves original message/history; bounded context candidates; punctuation/spacing variants now deduplicate by canonical key; 102 tests pass | Add Thai/English romanization fixture set and adversarial multi-entity cases |
| 2 | Tool selection and argument construction | Model-first hints, `tool_choice=auto`, approved URL/page-reader boundary, bounded tool rounds | Expand local trace assertions for wrong tool, missing argument, duplicate call and prompt injection |
| 3 | Structured output | Versioned structured prompt/JSON validation and malformed-response failures exist | Add schema mutation/property cases without provider calls |
| 4 | Error/timeout/retry | Timeout, malformed response, repeated tool-call and retry-limit tests exist | Add deterministic timing budget and cancellation tests |
| 5 | Evidence/grounding | URL allowlist, ranking, dedup, relevance and truthful degraded states exist | Add fact/inference/unknown response contract fixtures |
| 6 | Multilingual behavior | Thai/English/mixed routing and follow-up tests exist | Add explicit romanization/transliteration corpus; no automatic invented spellings |
| 7 | Evaluation consistency | 10-category benchmark and deterministic conversation corpus exist | Add repeated-run trace comparison; semantic quality remains manual/paired only |

## Completion rule

งานใดจะเป็น `VERIFIED COMPLETE` ได้ก็ต่อเมื่อมี targeted test, full regression,
failure evidence และไม่มีข้อจำกัดที่ยังถูกซ่อนอยู่ ส่วน semantic parity กับ GPT
จะคงเป็น `NOT VERIFIED` จนกว่าจะมี paired captures ที่ผู้ประเมินตรวจจริง
