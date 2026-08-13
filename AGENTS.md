# SOLAT V2 development rules

- Keep V2 separate from the V1 archive.
- Keep the renderer on a narrow, secure IPC bridge (`contextIsolation` on,
  `nodeIntegration` off).
- Keep the model provider behind the small provider interface.
- Never put API keys in source, logs, screenshots, commits, or the renderer.
- Provider failures must be visible; never return fake success.
- Add a deterministic test for each behavior change.
- Do not add search, memory, music, slides, or creative layers until Milestone 1
  is explicitly accepted.
