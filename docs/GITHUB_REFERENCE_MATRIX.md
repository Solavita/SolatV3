# GitHub reference matrix — Model Foundation

อัปเดต 2026-08-14. รายการนี้เป็น research/reference ไม่ใช่การเพิ่ม dependency โดยอัตโนมัติ

| Repository | Owner | License | Scope / source ที่ตรวจ | Runtime/dependency fit | Security/maintenance | Decision/status |
|---|---|---|---|---|---|---|
| https://github.com/openai/openai-agents-python | openai | MIT | `src/agents/run_context.py`: context wrapper แยก dependency/tool lifecycle จากข้อความที่ส่งให้โมเดล; README ระบุ sessions, tools, guardrails และ Python 3.10+ | ไม่ตรงกับ SOLAT ที่เป็น Node/Electron; นำแนวคิดแยก context state กับ provider input มาใช้ได้โดยไม่เพิ่ม Python runtime | Public, active, มี tests/CI; ต้องตรวจ approval/tool identity อย่างเข้มงวดก่อนนำแนวคิดไปใช้ | **REVIEWED → SANDBOX TESTED (concept only)**; ไม่ copy code/dependency |
| https://github.com/deepset-ai/fastapi-openai-compat | deepset-ai | Apache-2.0 | `src/fastapi_openai_compat`: request envelope, tool calling, streaming และ callback boundary; README/source ระบุ domain validation อยู่ที่ callback | เป็น Python/FastAPI จึงไม่เหมาะเป็น dependency ใน Electron; หลักการ adapter boundary ตรงกับ `src/core/provider.js` | Public, 31 commits, tests/CI; transport layer intentionally passes inner items through จึงต้องเพิ่ม validation ใน SOLAT เอง | **REVIEWED**; reference only, ไม่ integrate |
| https://github.com/harness/harness-evals | harness | Apache-2.0 | README/source contract: Golden → EvalCase → Score, structured-output/schema metrics, failure-returning evaluation และ CI exit codes | Python package และ optional paid/LLM extras ไม่ตรง local Node harness; schema/test artifact pattern นำมาปรับได้ | Public, license ชัด; optional integrations เพิ่ม network/secret risk จึงไม่ติดตั้ง | **REVIEWED**; adapted as local JSON benchmark shape only |
| https://github.com/responsibleai/ASSERT | responsibleai | MIT | README: requirement-driven scenarios, local-first artifacts, trace-aware assertions และ optional LLM judge | Python/OTel integrations ไม่ตรง SOLAT; scenario/evidence separation ใช้เป็น reference | Public Microsoft project, license/third-party notices ต้องคงตาม repo; external judge ไม่ใช้ใน local checkpoint | **REVIEWED**; reference only |
| https://github.com/EleutherAI/lm-evaluation-harness | EleutherAI | Apache-2.0 (repository license) | model wrapper interface, reproducible task/evaluator separation และ test expectations ใน `lm_eval` | Python-heavy, broad benchmark dependency ไม่เหมาะฝังใน desktop app; ใช้หลักฐานแยก adapter/evaluator | Mature/public, แต่ dependency footprint สูงและ benchmark semantics ไม่ตรง conversation routing | **REVIEWED → REJECTED for dependency**; no code copied |
| https://github.com/nemori-ai/nemori | nemori-ai | MIT (README) | episodic-memory concept and queryable memory fabric | Python 3.10+ and external model assumptions; ไม่ตรงกับ session-isolated local SOLAT foundation | Public but small/MVP and memory persistence risk; ไม่ใช้เป็น production memory | **REVIEWED → REJECTED for integration**; concept only |
| https://github.com/antoinezambelli/forge | antoinezambelli | License not confirmed sufficiently | README แนวคิด guardrails/tool loops/context compaction; source/license ไม่ยืนยันครบ | ไม่ควรนำเข้าจนกว่าจะยืนยัน license/dependency | **REJECTED**; ไม่ copy ไม่ติดตั้ง |

## Sandbox/adaptation decision

ไม่มี repository ใดถูก copy เข้า production และไม่มี dependency ใหม่ถูกติดตั้งในรอบนี้

แนวคิดที่นำมาปรับใน SOLAT คือ:

1. context object/state ต้องแยกจากข้อความต้นฉบับ และข้อความผู้ใช้ต้องถูกส่งครบ
2. tool call identity/arguments ต้องถูกตรวจและ failure ต้องไม่กลายเป็น success
3. evaluation artifact ต้องแยก expected behavior, actual evidence และ `NOT VERIFIED`
4. benchmark ต้องทำงาน local/free และไม่สร้าง semantic score เทียบ GPT เอง

การปรับที่มีหลักฐานในรอบนี้อยู่ใน `src/core/intent-router.js` และ regression ใน
`test/core.test.js`; เป็น implementation ของ SOLAT เอง ไม่ใช่การนำโค้ดจาก repository ภายนอกมาแปะ

## License/security boundary

- MIT/Apache-2.0 ถูกพิจารณาได้ในเชิง license แต่ยังไม่ได้นำ code มาเป็น dependency
- ห้ามนำ `.env`, credential, trace ภายนอก หรือข้อมูลส่วนตัวเข้า benchmark
- paid provider และ external judge ถูกปิดไว้ในรอบ local/free นี้

## 2026-08-15 research addendum

| Repository | License | Reviewed scope | Compatibility / decision |
|---|---|---|---|
| https://github.com/responsibleai/ASSERT | MIT | Local-first, trace-grounded evaluation artifacts and requirement assertions | REVIEWED; reference only. Python/OTel dependency is not added to the Node/Electron runtime. |
| https://github.com/harness/harness-evals | Apache-2.0 | Structural/schema, tool-correctness, reliability and rubric evaluation concepts | REVIEWED; adapted conceptually into existing JSON reports; no dependency or paid evaluator added. |
| https://github.com/ajv-validator/ajv | MIT | JSON Schema validation | REVIEWED; not added because SOLAT already has a bounded dependency-free validator and changing it would add unnecessary runtime surface. |
| https://github.com/modelcontextprotocol/typescript-sdk | Apache-2.0 / MIT legacy code | MCP tool/resource protocol | REVIEWED; not integrated because current adapter boundary is sufficient and adding MCP would expand scope without a tested provider. |

No external repository code or dependency was copied into production in this iteration.

## 2026-08-15 Agent V3.1 research

| Repository | License/version | Reviewed source/fit | Decision |
|---|---|---|---|
| https://github.com/microsoft/winappCli | MIT / v0.6.0 | Windows UI Automation list/inspect/invoke/set-value/wait-for JSON CLI; Electron-compatible, semantic selectors, active Microsoft project | **INTEGRATED AS PINNED EXTERNAL ADAPTER**. Installed through Winget with published SHA-256 verification; SOLAT exposes only four bounded tools through `spawn(shell:false)`, adds sensitive-window/password denial, limits and approval, and uses `wait-for` to verify the requested post-action state instead of trusting exit code alone. |
| https://github.com/sbroenne/mcp-windows | MIT / reviewed 2026-08-15 | Dedicated STA UIA worker, semantic element references, schema-derived tools and post-mutation refresh | **REVIEWED / ADAPTED CONCEPTS ONLY**; .NET 10 sidecar and broad surface were not imported. |
| https://github.com/openai/openai-agents-js | MIT / reviewed 2026-08-15 | Canonical tool identity, argument validation, approval state, bounded cancellation and resumable run-state patterns | **REVIEWED / ADAPTED CONCEPTS ONLY** into existing AgentService; dependency rejected to preserve DeepSeek/model-agnostic architecture. |
| https://github.com/npm/write-file-atomic | ISC / v8.0.0 | temp-write, fsync, rename and cleanup algorithm | **REVIEWED / ADAPTED ALGORITHM ONLY**; dependency rejected because current engine constraints may not match Electron and SOLAT needs stronger path/hash/ownership rules. |
| https://github.com/modelcontextprotocol/typescript-sdk | Apache-2.0/MIT | Tool schema/cancellation boundary; reviewed advisory affecting shared transports before v1.26.0 | **REVIEWED / NOT INTEGRATED**; no arbitrary MCP discovery is exposed. |
| https://github.com/BAAI-Agents/Cradle | MIT / reviewed 2026-08-22 | Unified environment runner, atomic/composite skill registry, provider separation, and migration-specific app boundaries | **REVIEWED / ADAPTED CONCEPTS ONLY**. SOLAT's existing bounded tool registry, workflow hints, and provider adapters implement the compatible separation without importing Cradle's Python/game stack or screenshot-every-step loop. No code copied. |
| https://github.com/showlab/WorldGUI | License not present in the reviewed repository / reviewed 2026-08-22 | Planner-Critic, pre-execution Step-Check, and post-action Actor-Critic; screenshot/OCR/PyAutoGUI action pipeline | **REVIEWED / CONCEPT ONLY, CODE REJECTED**. SOLAT keeps strict step-schema validation and verified postconditions, but does not copy or depend on WorldGUI because its license was not confirmed and raw coordinate execution conflicts with SOLAT's exact-HWND/UIA safety boundary. |

No repository was copied wholesale. `src/core/filesystem-workspace.js` and the approval/tool composition are SOLAT-native implementations.

## 2026-08-15 implementation boundary

The current local changes use existing SOLAT contracts and do not add a GitHub dependency. File-intake, derived persistence, agent approval boundaries and evaluation manifest work are SOLAT-native adaptations; external repositories remain reference-only with license review recorded above. No secret, provider credential or external repository code was copied.
