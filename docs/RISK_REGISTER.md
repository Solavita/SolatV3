# Risk register — Model Foundation

อัปเดต 2026-08-14

| ID | Risk | Impact | Mitigation/evidence | Status |
|---|---|---|---|---|
| MF-01 | Semantic answer quality is not proven by deterministic routing tests | อาจเข้าใจผิดว่า router ผ่านแล้ว model ตอบดี | แยก `NOT VERIFIED` ใน evaluator; ห้ามสร้าง GPT parity score | OPEN |
| MF-02 | Ambiguous names can map to multiple real entities | อ้างข้อมูลผิดตัว | bounded candidates, canonical spacing/hyphen dedupe, ask clarification when unresolved | MITIGATED; more adversarial cases pending |
| MF-03 | Model emits malformed or repeated tool calls | loop/corrupt evidence | schema validation, tool identity checks, timeout and round caps | MITIGATED; cancellation tests pending |
| MF-04 | Search result is approved but not relevant | hallucinated grounding | URL allowlist, query-token relevance, ranking/dedup and truthful empty/degraded states | MITIGATED; broader corpus pending |
| MF-05 | External GitHub code/license/dependency risk | legal/security/maintenance debt | matrix review; no unverified code copied or installed | MITIGATED |
| MF-06 | Thai romanization/typo normalization may over-correct | wrong entity or lost user wording | preserve original message; only bounded spacing/hyphen variants; no invented correction | OPEN |
| MF-07 | Local tests do not cover provider-specific semantics | false confidence | paid/live provider tests intentionally marked `NOT VERIFIED` | OPEN |
