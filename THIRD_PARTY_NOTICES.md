# Third-party notices

## MediaPipe Tasks Vision

- Component: `@mediapipe/tasks-vision` 1.0.1
- Owner: Google / MediaPipe Authors
- License: Apache License 2.0 (see `LICENSES/Apache-2.0.txt`)
- Use: renderer-local Hand Landmarker inference; SOLAT sends only validated
  landmark metadata across IPC.

## Hand Landmarker task model

- Source:
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- Official sample reference:
  `https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/hand-landmarker.ts`
- Official model card and license statement:
  `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf`
- Local file: `renderer/assets/hand_landmarker.task`
- Size: 7,819,105 bytes
- SHA-256:
  `FBC2A30080C3C557093B5DDFC334698132EB341044CCEE322CCF8BCF3607CDE1`

The model is distributed unchanged. The official MediaPipe repository and
sample source are Apache-2.0 licensed. This notice records the exact source and
artifact identity and does not grant rights beyond the applicable upstream
terms.

MediaPipe's upstream documentation discloses performance/utilization metrics
for Tasks APIs. SOLAT loads the bundle, WASM, and model from its local package,
and the renderer CSP limits `connect-src` to `'self'`. This is a mitigation,
not evidence of network-zero; packaged network capture and any consent/legal
review remain outside this notice.
