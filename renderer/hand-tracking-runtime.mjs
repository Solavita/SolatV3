const MODEL_URL = new URL('./assets/hand_landmarker.task', import.meta.url).href;
const WASM_ROOT = new URL('../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href.replace(/\/$/u, '');

export class HandTrackingRuntime {
  constructor({ bridge = window.solat, onEvent = () => {}, onState = () => {}, mediaDevices = navigator.mediaDevices, raf = requestAnimationFrame, cancelRaf = cancelAnimationFrame, documentRef = document, detectorFactory = null, now = Date.now } = {}) {
    this.bridge = bridge; this.onEvent = onEvent; this.onState = onState; this.mediaDevices = mediaDevices; this.raf = raf; this.cancelRaf = cancelRaf;
    this.documentRef = documentRef; this.now = now;
    this.detectorFactory = detectorFactory || (async () => {
      const { FilesetResolver, HandLandmarker } = await import('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      return HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      });
    });
    this.active = false; this.generation = 0; this.startPromise = null; this.stream = null; this.video = null; this.detector = null; this.frameHandle = 0; this.lastAt = 0; this.lastFrameEpochMs = 0; this.sessionId = '';
  }

  async start(sessionId) {
    if (this.active) return true;
    if (this.startPromise) return this.startPromise;
    const pending = this.#start(sessionId);
    this.startPromise = pending;
    try { return await pending; }
    finally { if (this.startPromise === pending) this.startPromise = null; }
  }

  async #start(sessionId) {
    if (!this.bridge?.handStart || !this.bridge?.handFrame || !this.mediaDevices?.getUserMedia) throw new Error('Hand tracking is unavailable.');
    const generation = ++this.generation; this.sessionId = String(sessionId || '').trim();
    if (!this.sessionId) throw new Error('A conversation session is required for hand tracking.');
    this.onState('starting');
    let stream; let video; let detector;
    try {
      stream = await this.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
      if (generation !== this.generation) throw Object.assign(new Error('Hand tracking start was cancelled.'), { code: 'hand_start_cancelled' });
      video = this.documentRef.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = stream;
      video.hidden = true; this.documentRef.body.appendChild(video); await video.play();
      detector = await this.detectorFactory();
      if (generation !== this.generation) throw Object.assign(new Error('Hand tracking start was cancelled.'), { code: 'hand_start_cancelled' });
      await this.bridge.handStart({ sessionId: this.sessionId, contextId: `hand:${this.sessionId}` });
      this.stream = stream; this.video = video; this.detector = detector; this.active = true; this.onState('tracking');
      this.#schedule(generation); return true;
    } catch (error) {
      detector?.close?.(); if (video) { video.pause(); video.srcObject = null; video.remove(); }
      for (const track of stream?.getTracks?.() || []) track.stop();
      this.active = false; this.onState(error?.code === 'hand_start_cancelled' ? 'idle' : 'error', error); throw error;
    }
  }

  #schedule(generation) { this.frameHandle = this.raf(timestamp => { void this.#frame(generation, timestamp); }); }

  async #frame(generation, timestamp) {
    if (!this.active || generation !== this.generation) return;
    try {
      if (timestamp - this.lastAt >= 66 && this.video?.readyState >= 2) {
        this.lastAt = timestamp;
        const result = this.detector.detectForVideo(this.video, Math.round(timestamp));
        const landmarks = Array.isArray(result?.landmarks) ? result.landmarks : [];
        const handednesses = Array.isArray(result?.handednesses) ? result.handednesses : [];
        const hands = landmarks.slice(0, 2).map((points, index) => {
          const category = handednesses[index]?.[0] || {};
          return {
            hand_id: `${String(category.categoryName || category.displayName || 'unknown').toLowerCase()}-${index}`,
            handedness: String(category.categoryName || category.displayName || 'unknown').toLowerCase(),
            score: Number(category.score ?? 1),
            landmarks: points.map(point => ({ x: point.x, y: point.y, z: point.z || 0, visibility: point.visibility ?? 1 })),
          };
        });
        const epochTimestampMs = Math.max(this.lastFrameEpochMs + 1, Math.round(this.now()));
        this.lastFrameEpochMs = epochTimestampMs;
        await this.bridge.handFrame({
          sessionId: this.sessionId,
          frame: { schema_version: 'solat.hand-landmarks.v1', frame_id: `camera-${epochTimestampMs}`, timestamp_ms: epochTimestampMs, coordinate_space: 'normalized-0..1', hands },
        });
      }
    } catch (error) {
      this.onState('error', error); await this.stop(); return;
    }
    this.#schedule(generation);
  }

  async stop() {
    const sessionId = this.sessionId; ++this.generation; this.active = false;
    if (this.frameHandle) this.cancelRaf(this.frameHandle); this.frameHandle = 0;
    this.detector?.close?.(); this.detector = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null; }
    for (const track of this.stream?.getTracks?.() || []) track.stop(); this.stream = null;
    if (sessionId) await this.bridge?.handStop?.({ sessionId }).catch(() => {});
    this.sessionId = ''; this.lastFrameEpochMs = 0; this.onState('idle'); return true;
  }
}
