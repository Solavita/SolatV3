(function voiceControllerModule(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.SolatVoiceController = exported.VoiceController;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const VOICE_STATES = Object.freeze([
    'idle', 'listening', 'user_speaking', 'transcribing', 'thinking',
    'acting', 'speaking', 'interrupted', 'error',
  ]);
  const VOICE_STATE_SET = new Set(VOICE_STATES);

  class VoiceController {
    constructor({
      bridge,
      mediaDevices = globalThis.navigator?.mediaDevices,
      AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
      AudioClass = globalThis.Audio,
      BlobClass = globalThis.Blob,
      urlApi = globalThis.URL,
      onState = () => {},
      onPartial = () => {},
      onFinalTranscript = async () => {},
      onError = () => {},
      rmsSpeechThreshold = 0.025,
      rmsBargeInThreshold = 0.08,
      bargeInSettleMs = 120,
      debugLogger = (...args) => globalThis.console?.debug?.(...args),
      delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    } = {}) {
      this.bridge = bridge;
      this.mediaDevices = mediaDevices;
      this.AudioContextClass = AudioContextClass;
      this.AudioClass = AudioClass;
      this.BlobClass = BlobClass;
      this.urlApi = urlApi;
      this.onState = onState;
      this.onPartial = onPartial;
      this.onFinalTranscript = onFinalTranscript;
      this.onError = onError;
      this.rmsSpeechThreshold = rmsSpeechThreshold;
      this.rmsBargeInThreshold = rmsBargeInThreshold;
      this.bargeInSettleMs = bargeInSettleMs;
      this.delay = delay;
      this.debugLogger = typeof debugLogger === 'function' ? debugLogger : () => {};
      this.state = 'idle';
      this.active = false;
      this.dispatching = false;
      this.conversationSessionId = '';
      this.voiceSessionId = '';
      this.sessionCounter = 0;
      this.finalUtterances = new Set();
      this.unsubscribe = null;
      this.stream = null;
      this.audioContext = null;
      this.source = null;
      this.processor = null;
      this.silentGain = null;
      this.pendingSamples = new Float32Array(0);
      this.pushChain = Promise.resolve();
      this.queuedChunks = 0;
      this.sttActive = false;
      this.audio = null;
      this.audioUrl = '';
      this.ttsGeneration = 0;
      this.bargeInFrames = 0;
      this.interruptPromise = null;
      this.exitPromise = null;
      this.lifecycleGeneration = 0;
      this.sttStartedAt = 0;
      this.sttAudioBytes = 0;
      this.sttChunksSent = 0;
      this.vadSpeechActive = false;
      this.vadSilenceChunks = 0;
      this.maxVadSilenceChunks = 5;
      this.ttsResponseCounts = new Map();
      this.ttsRequestKeys = new Set();
      this.speechQueue = [];
      this.speechStreamRequest = '';
      this.speechStreamLanguage = 'auto';
      this.speechStreamEnded = false;
      this.speechStreamSeq = 0;
      this.speechWorkerActive = false;
    }

    setState(next, detail = {}) {
      if (!VOICE_STATE_SET.has(next)) throw new TypeError(`Unknown voice state: ${next}`);
      this.state = next;
      this.onState(next, detail);
    }

    async enter(conversationSessionId) {
      if (this.exitPromise) await this.exitPromise;
      const generation = ++this.lifecycleGeneration;
      const sessionId = String(conversationSessionId || '').trim();
      if (!sessionId) throw this.#error('invalid_voice_session', 'A conversation is required for voice mode.');
      if (!this.bridge?.voiceStatus || !this.bridge?.voiceStartSTT) throw this.#error('voice_bridge_unavailable', 'Secure voice IPC is unavailable.');
      const status = await this.bridge.voiceStatus();
      if (generation !== this.lifecycleGeneration) return false;
      if (!status?.stt?.configured || !status?.tts?.configured) throw this.#error('voice_not_configured', 'Add the Cartesia API key and voice id to the local environment.');
      this.active = true;
      this.conversationSessionId = sessionId;
      if (!this.unsubscribe && this.bridge.onVoiceEvent) this.unsubscribe = this.bridge.onVoiceEvent(event => this.#receive(event));
      try {
        const initialized = await this.#ensureMicrophone(generation);
        if (!initialized || generation !== this.lifecycleGeneration) return false;
        const listening = await this.startListening(generation);
        if (!listening || generation !== this.lifecycleGeneration) return false;
        return status;
      } catch (error) {
        if (generation !== this.lifecycleGeneration) return false;
        const failedSessionId = this.voiceSessionId;
        this.active = false;
        this.sttActive = false;
        if (failedSessionId) await this.bridge?.voiceDispose?.({ sessionId: failedSessionId }).catch(() => {});
        this.voiceSessionId = '';
        await this.#releaseMicrophone();
        this.unsubscribe?.();
        this.unsubscribe = null;
        throw error;
      }
    }

    async toggle(conversationSessionId) {
      if (this.active && ['listening', 'user_speaking', 'transcribing'].includes(this.state)) {
        await this.exit();
        return false;
      }
      await this.enter(conversationSessionId);
      return true;
    }

    async startListening(expectedGeneration = this.lifecycleGeneration) {
      if (!this.active || expectedGeneration !== this.lifecycleGeneration) return false;
      await this.#cancelSTT();
      if (!this.active || expectedGeneration !== this.lifecycleGeneration) return false;
      const sessionId = `${this.conversationSessionId}:voice:${++this.sessionCounter}`;
      this.voiceSessionId = sessionId;
      this.pendingSamples = new Float32Array(0);
      this.vadSpeechActive = false;
      this.vadSilenceChunks = 0;
      this.finalUtterances.clear();
      this.dispatching = false;
      await this.bridge.voiceStartSTT({
        sessionId,
        sampleRate: this.audioContext.sampleRate,
        encoding: 'pcm_f32le',
      });
      if (!this.active || expectedGeneration !== this.lifecycleGeneration || this.voiceSessionId !== sessionId) {
        await this.bridge?.voiceCancelSTT?.({ sessionId }).catch(() => {});
        await this.bridge?.voiceDispose?.({ sessionId }).catch(() => {});
        if (this.voiceSessionId === sessionId) this.voiceSessionId = '';
        return false;
      }
      this.sttActive = true;
      this.sttStartedAt = performance.now();
      this.sttAudioBytes = 0;
      this.sttChunksSent = 0;
      this.#log('stt-start', { sessionId, conversationId: this.conversationSessionId, sampleRate: this.audioContext.sampleRate, encoding: 'pcm_f32le' });
      this.setState('listening');
      return true;
    }

    markThinking() {
      if (this.active && this.state !== 'speaking') this.setState('thinking');
    }

    markActing() {
      if (this.active && !['speaking', 'interrupted'].includes(this.state)) this.setState('acting');
    }

    async speak(text, language = 'auto', contextId = '') {
      const transcript = String(text || '').trim();
      if (!this.active || !transcript || !this.voiceSessionId) return false;
      const requestId = String(contextId || this.conversationSessionId || '').trim();
      const textKey = `${requestId}:${transcript.length}:${this.#fingerprint(transcript)}`;
      const responseCount = (this.ttsResponseCounts.get(requestId) || 0) + 1;
      if (this.ttsRequestKeys.has(textKey)) {
        this.#log('tts-duplicate-suppressed', { requestId, contextId: requestId, textLength: transcript.length, responseCount });
        return false;
      }
      this.ttsRequestKeys.add(textKey);
      this.ttsResponseCounts.set(requestId, responseCount);
      const generation = ++this.ttsGeneration;
      this.#log('tts-request', { requestId, contextId: requestId, generation, textLength: transcript.length, responseCount, cancelled: false });
      try {
        // Enter the interruptible state before awaiting the full-buffer TTS
        // response so a user can barge in during provider generation as well
        // as during local playback.
        this.setState('speaking', { pendingAudio: true });
        const result = await this.bridge.voiceSpeak({ sessionId: this.voiceSessionId, text: transcript, language });
        if (!this.active || generation !== this.ttsGeneration) return false;
        const bytes = result?.audio instanceof Uint8Array ? result.audio : new Uint8Array(result?.audio || []);
        if (!bytes.byteLength) throw this.#error('malformed_tts_response', 'The speech provider returned no audio.');
        this.#stopAudio();
        this.audioUrl = this.urlApi.createObjectURL(new this.BlobClass([bytes], { type: result.mimeType || 'audio/wav' }));
        this.audio = new this.AudioClass(this.audioUrl);
        this.setState('speaking', { pendingAudio: false });
        await new Promise((resolve, reject) => {
          this.audio.onended = resolve;
          this.audio.onerror = () => reject(this.#error('audio_playback_failed', 'SOLAT could not play the generated speech.'));
          Promise.resolve(this.audio.play()).catch(reject);
        });
        if (!this.active || generation !== this.ttsGeneration) return false;
        this.#stopAudio();
        await this.startListening();
        return true;
      } catch (error) {
        if (error?.code === 'tts_cancelled' || generation !== this.ttsGeneration || !this.active) {
          this.#log('tts-result', { requestId, contextId: requestId, generation, textLength: transcript.length, responseCount, cancelled: true });
          return false;
        }
        this.#log('tts-result', { requestId, contextId: requestId, generation, textLength: transcript.length, responseCount, cancelled: false, error: error?.code || 'tts_error' });
        this.#fail(error);
        return false;
      }
    }

    // Ordered sentence-chunk speech for streamed assistant responses. The
    // renderer chunks coherent sentence boundaries and queues them here so
    // speech can start before the full answer exists, without one TTS request
    // per token and without resending cumulative text.
    beginSpeechStream(requestId = '', language = 'auto') {
      if (!this.active) return false;
      this.speechStreamRequest = String(requestId || '').trim();
      this.speechStreamLanguage = language;
      this.speechStreamEnded = false;
      this.speechStreamSeq = 0;
      this.speechQueue.length = 0;
      return true;
    }

    queueSpeechChunk(requestId, chunkText) {
      const transcript = String(chunkText || '').trim();
      if (!this.active || !transcript || !this.voiceSessionId) return false;
      const id = String(requestId || '').trim();
      // Chunks are accepted only for the live stream. A barge-in, stop, or
      // exit clears the stream request, so the abandoned response's remaining
      // chunks are dropped instead of being spoken over the next session.
      if (!this.speechStreamRequest || id !== this.speechStreamRequest) return false;
      this.speechStreamSeq += 1;
      this.speechQueue.push({ requestId: this.speechStreamRequest, seq: this.speechStreamSeq, text: transcript });
      void this.#drainSpeechQueue();
      return true;
    }

    endSpeechStream(requestId = '') {
      if (!this.active) return false;
      const id = String(requestId || '').trim();
      if (id && this.speechStreamRequest && id !== this.speechStreamRequest) return false;
      this.speechStreamEnded = true;
      void this.#drainSpeechQueue();
      return true;
    }

    async #drainSpeechQueue() {
      if (this.speechWorkerActive) return;
      this.speechWorkerActive = true;
      try {
        while (this.active && this.speechQueue.length > 0) {
          const outcome = await this.#playSpeechChunk(this.speechQueue[0]);
          if (outcome !== 'played' && outcome !== 'skipped') {
            // A barge-in, stop or failure owns the next session transition;
            // drop the remaining chunks of this response instead of speaking
            // a stale tail after the user interrupted.
            this.speechQueue.length = 0;
            this.speechStreamEnded = false;
            return;
          }
          this.speechQueue.shift();
        }
        if (this.active && this.speechStreamEnded) {
          this.speechStreamEnded = false;
          this.speechStreamRequest = '';
          await this.startListening();
        }
      } finally {
        this.speechWorkerActive = false;
      }
    }

    async #playSpeechChunk(item) {
      const contextKey = `${item.requestId}:chunk:${item.seq}`;
      const textKey = `${contextKey}:${item.text.length}:${this.#fingerprint(item.text)}`;
      if (this.ttsRequestKeys.has(textKey)) {
        this.#log('tts-duplicate-suppressed', { requestId: item.requestId, contextId: contextKey, textLength: item.text.length, responseCount: this.ttsResponseCounts.get(item.requestId) || 0 });
        return 'skipped';
      }
      this.ttsRequestKeys.add(textKey);
      this.ttsResponseCounts.set(item.requestId, (this.ttsResponseCounts.get(item.requestId) || 0) + 1);
      const generation = ++this.ttsGeneration;
      this.#log('tts-request', { requestId: item.requestId, contextId: contextKey, generation, textLength: item.text.length, responseCount: this.ttsResponseCounts.get(item.requestId), cancelled: false });
      try {
        this.setState('speaking', { pendingAudio: true });
        const result = await this.bridge.voiceSpeak({ sessionId: this.voiceSessionId, text: item.text, language: this.speechStreamLanguage });
        if (!this.active || generation !== this.ttsGeneration) return 'cancelled';
        const bytes = result?.audio instanceof Uint8Array ? result.audio : new Uint8Array(result?.audio || []);
        if (!bytes.byteLength) throw this.#error('malformed_tts_response', 'The speech provider returned no audio.');
        this.#stopAudio();
        this.audioUrl = this.urlApi.createObjectURL(new this.BlobClass([bytes], { type: result.mimeType || 'audio/wav' }));
        this.audio = new this.AudioClass(this.audioUrl);
        this.setState('speaking', { pendingAudio: false });
        await new Promise((resolve, reject) => {
          this.audio.onended = resolve;
          this.audio.onerror = () => reject(this.#error('audio_playback_failed', 'SOLAT could not play the generated speech.'));
          Promise.resolve(this.audio.play()).catch(reject);
        });
        if (!this.active || generation !== this.ttsGeneration) return 'cancelled';
        this.#stopAudio();
        return 'played';
      } catch (error) {
        if (error?.code === 'tts_cancelled' || generation !== this.ttsGeneration || !this.active) {
          this.#log('tts-result', { requestId: item.requestId, contextId: contextKey, generation, textLength: item.text.length, cancelled: true });
          return 'cancelled';
        }
        this.#log('tts-result', { requestId: item.requestId, contextId: contextKey, generation, textLength: item.text.length, cancelled: false, error: error?.code || 'tts_error' });
        this.#fail(error);
        return 'failed';
      }
    }

    async interrupt() {
      if (this.interruptPromise) return false;
      if (!this.active || this.state !== 'speaking') return false;
      const sessionId = this.voiceSessionId;
      this.ttsGeneration += 1;
      this.speechQueue.length = 0;
      this.speechStreamEnded = false;
      this.speechStreamRequest = '';
      this.#stopAudio();
      // Leave `speaking` before the asynchronous provider cancellation so
      // successive audio frames cannot start overlapping interruption flows.
      this.setState('interrupted');
      const operation = (async () => {
        await this.#cancelTTS('barge-in', sessionId);
        if (!this.active) return false;
        if (this.bargeInSettleMs > 0) await this.delay(this.bargeInSettleMs);
        if (!this.active) return false;
        await this.startListening();
        return true;
      })();
      this.interruptPromise = operation;
      try {
        return await operation;
      } finally {
        if (this.interruptPromise === operation) this.interruptPromise = null;
      }
    }

    async stop() {
      this.ttsGeneration += 1;
      this.speechQueue.length = 0;
      this.speechStreamEnded = false;
      this.speechStreamRequest = '';
      this.#stopAudio();
      await Promise.allSettled([
        this.#cancelSTT(),
        this.voiceSessionId ? this.#cancelTTS('stop', this.voiceSessionId) : null,
      ]);
      this.setState('idle');
    }

    async exit() {
      if (this.exitPromise) return this.exitPromise;
      this.lifecycleGeneration += 1;
      this.active = false;
      const sessionId = this.voiceSessionId;
      const operation = (async () => {
      this.ttsGeneration += 1;
      this.speechQueue.length = 0;
      this.speechStreamEnded = false;
      this.speechStreamRequest = '';
      this.#stopAudio();
      this.#logSTTStop('exit', sessionId);
      this.sttActive = false;
        await Promise.allSettled([
          sessionId ? this.bridge?.voiceCancelSTT?.({ sessionId }) : null,
          sessionId ? this.#cancelTTS('exit', sessionId) : null,
        ]);
        if (sessionId) await this.bridge?.voiceDispose?.({ sessionId }).catch(() => {});
        if (this.voiceSessionId === sessionId) this.voiceSessionId = '';
        this.dispatching = false;
        await this.#releaseMicrophone();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.setState('idle');
      })();
      this.exitPromise = operation.finally(() => {
        this.exitPromise = null;
      });
      return this.exitPromise;
    }

    async #ensureMicrophone(expectedGeneration = this.lifecycleGeneration) {
      if (this.audioContext && this.stream) return true;
      if (!this.mediaDevices?.getUserMedia || !this.AudioContextClass) throw this.#error('microphone_unavailable', 'Microphone capture is unavailable on this device.');
      const stream = await this.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      let audioContext = null;
      let source = null;
      let processor = null;
      let silentGain = null;
      try {
        audioContext = new this.AudioContextClass();
        if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') await audioContext.resume();
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        processor.onaudioprocess = event => this.#capture(event.inputBuffer.getChannelData(0));
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
        if (!this.active || expectedGeneration !== this.lifecycleGeneration) {
          processor.disconnect?.();
          source.disconnect?.();
          silentGain.disconnect?.();
          stream?.getTracks?.().forEach(track => track.stop());
          if (audioContext.state !== 'closed') await audioContext.close().catch(() => {});
          return false;
        }
        this.stream = stream;
        this.audioContext = audioContext;
        this.source = source;
        this.processor = processor;
        this.silentGain = silentGain;
        return true;
      } catch (error) {
        processor?.disconnect?.();
        source?.disconnect?.();
        silentGain?.disconnect?.();
        stream?.getTracks?.().forEach(track => track.stop());
        if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
        throw error;
      }
    }

    #capture(samples) {
      if (!this.active) return;
      let squareSum = 0;
      for (let index = 0; index < samples.length; index += 1) squareSum += samples[index] * samples[index];
      const rms = Math.sqrt(squareSum / Math.max(1, samples.length));
      if (this.state === 'speaking') {
        this.bargeInFrames = rms >= this.rmsBargeInThreshold ? this.bargeInFrames + 1 : 0;
        if (this.bargeInFrames >= 2) {
          this.bargeInFrames = 0;
          void this.interrupt();
        }
        return;
      }
      this.bargeInFrames = 0;
      if (!this.sttActive || !['listening', 'user_speaking'].includes(this.state)) return;
      if (rms >= this.rmsSpeechThreshold) {
        if (this.state === 'listening') this.setState('user_speaking');
        this.vadSpeechActive = true;
        this.vadSilenceChunks = 0;
        this.#appendChunk(samples);
        return;
      }
      // Do not continuously bill Cartesia while the user is silent. A short
      // bounded tail lets Cartesia auto-finalize the utterance, then capture
      // stays local until a new above-threshold frame arrives.
      if (this.vadSpeechActive && this.vadSilenceChunks < this.maxVadSilenceChunks) {
        this.vadSilenceChunks += 1;
        this.#appendChunk(samples);
      }
    }

    #appendChunk(samples) {
      const combined = new Float32Array(this.pendingSamples.length + samples.length);
      combined.set(this.pendingSamples);
      combined.set(samples, this.pendingSamples.length);
      const chunkSize = Math.round(this.audioContext.sampleRate / 10);
      let offset = 0;
      while (combined.length - offset >= chunkSize) {
        const chunk = new Float32Array(chunkSize);
        chunk.set(combined.subarray(offset, offset + chunkSize));
        offset += chunkSize;
        this.#pushChunk(new Uint8Array(chunk.buffer));
      }
      this.pendingSamples = combined.slice(offset);
    }

    #pushChunk(bytes) {
      if (this.queuedChunks >= 8 || !this.sttActive) return;
      this.queuedChunks += 1;
      const sessionId = this.voiceSessionId;
      this.sttAudioBytes += bytes.byteLength;
      this.sttChunksSent += 1;
      this.pushChain = this.pushChain
        .then(() => this.bridge.voicePushSTT({ sessionId, bytes }))
        .catch(error => { if (this.sttActive && sessionId === this.voiceSessionId) this.#fail(error); })
        .finally(() => { this.queuedChunks = Math.max(0, this.queuedChunks - 1); });
    }

    async #receive(event) {
      if (!event || event.schema_version !== 'solat.voice-provider-event.v1' || event.session_id !== this.voiceSessionId || !this.active) return;
      if (event.type === 'speech_start' || event.type === 'speech_resume') {
        this.setState('user_speaking');
      } else if (event.type === 'partial') {
        this.onPartial(String(event.transcript || ''));
      } else if (event.type === 'final') {
        const utteranceId = String(event.utterance_id || '');
        const transcript = String(event.transcript || '').trim();
        if (!utteranceId || !transcript || this.finalUtterances.has(utteranceId) || this.dispatching) return;
        const voiceSessionId = this.voiceSessionId;
        this.finalUtterances.add(utteranceId);
        this.dispatching = true;
        this.sttActive = false;
        this.#logSTTStop('final', voiceSessionId);
        this.setState('transcribing');
        await this.bridge.voiceStopSTT?.({ sessionId: voiceSessionId }).catch(() => {});
        this.setState('thinking');
        try {
          const receivedAtMs = Number(event.received_at_ms);
          const finalMetadata = Object.freeze({
            voiceSessionId,
            utteranceId,
            receivedAtMs: Number.isSafeInteger(receivedAtMs) && receivedAtMs >= 0 ? receivedAtMs : null,
          });
          const handled = await this.onFinalTranscript(transcript, utteranceId, finalMetadata);
          if (handled === false && this.active) await this.startListening();
        } catch (error) {
          this.#fail(error);
        }
      } else if (event.type === 'error') {
        this.#fail(this.#error(event.code || 'stt_provider_error', event.message || 'Speech recognition failed.'));
      }
    }

    async #cancelSTT() {
      if (!this.sttActive || !this.voiceSessionId) return false;
      const sessionId = this.voiceSessionId;
      this.sttActive = false;
      await this.bridge?.voiceCancelSTT?.({ sessionId }).catch(() => {});
      this.#logSTTStop('cancel', sessionId);
      return true;
    }

    async #cancelTTS(reason, sessionId) {
      if (!sessionId) return false;
      let cancelled = false;
      try { cancelled = Boolean(await this.bridge?.voiceCancelTTS?.({ sessionId })); } catch { cancelled = false; }
      this.#log('tts-cancel', { sessionId, reason, cancelled });
      return cancelled;
    }

    #logSTTStop(reason, sessionId = this.voiceSessionId) {
      if (!this.sttStartedAt) return;
      const durationMs = Math.max(0, Math.round(performance.now() - this.sttStartedAt));
      this.#log('stt-stop', { sessionId, reason, durationMs, audioBytesSent: this.sttAudioBytes, chunksSent: this.sttChunksSent, audioMsSent: Math.round(this.sttAudioBytes / 4 / Math.max(1, this.audioContext?.sampleRate || 48000) * 1000) });
      this.sttStartedAt = 0;
      this.sttAudioBytes = 0;
      this.sttChunksSent = 0;
    }

    #log(event, details = {}) {
      try { this.debugLogger({ schema: 'solat.voice-usage-debug.v1', event, at: new Date().toISOString(), ...details }); } catch {}
    }

    #fingerprint(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
      return (hash >>> 0).toString(16);
    }

    async #releaseMicrophone() {
      const processor = this.processor;
      const source = this.source;
      const silentGain = this.silentGain;
      const stream = this.stream;
      const audioContext = this.audioContext;
      this.processor = null;
      this.source = null;
      this.silentGain = null;
      this.stream = null;
      this.audioContext = null;
      processor?.disconnect?.();
      source?.disconnect?.();
      silentGain?.disconnect?.();
      stream?.getTracks?.().forEach(track => track.stop());
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    }

    #stopAudio() {
      if (this.audio) {
        this.audio.pause?.();
        this.audio.src = '';
        this.audio.onended = null;
        this.audio.onerror = null;
      }
      this.audio = null;
      if (this.audioUrl) this.urlApi.revokeObjectURL(this.audioUrl);
      this.audioUrl = '';
    }

    #fail(error) {
      this.setState('error', { code: error?.code || 'voice_error' });
      this.onError(error);
    }

    #error(code, message) {
      return Object.assign(new Error(message), { code });
    }
  }

  return { VOICE_STATES, VoiceController };
});
