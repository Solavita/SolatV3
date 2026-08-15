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
# 2026-08-15 quality iteration

- Baseline: 100 paired captures, preliminary GPT-judge quality 76.38%.
- Root-cause fix applied at `src/core/provider.js`: bounded Windows-874 mojibake repair at the provider response boundary, with normal Unicode pass-through regression coverage.
- Prompt contract strengthened in `src/core/conversation-core.js`: direct answers for ordinary chat, no invented search attempts, obey requested deliverable, concise output, and explicit encoding integrity.
- Local evidence: `npm.cmd test` 132/132 PASS; `npm.cmd run check` PASS; `git diff --check` PASS.
- The 100-pair semantic score has not been rerun after this change; therefore category improvement is NOT VERIFIED and no post-change score is claimed.

## Latest implementation boundary (2026-08-15)

- File intake now has a tested local path for TXT/JSON/CSV: immutable originals, persistent derived records, provenance/content hashes, row/line/path citations, bounded extraction, restart reload, owner/project/file scope and derived-only cleanup.
- PDF/DOCX/XLSX/image extraction, OCR and indexing remain `NOT VERIFIED`; no fake parser or fallback content is used.
- Agent orchestration has approval/audit/IPC contracts, but the production trusted-tool registry is empty; external side-effect execution remains `NOT VERIFIED`.
- Evaluation manifest preflight covers 300 unchanged references (A/B/C, 100 each). Live 300-case execution has not started; no new quality percentage is claimed.
- DeepSeek/Brave configuration code paths are present on D and packaged builds do not embed secrets; local `.env` configuration is now present, but live provider verification remains `NOT VERIFIED` until a bounded capture is completed.
