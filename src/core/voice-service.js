const Cartesia = require('@cartesia/cartesia-js');

const VOICE_EVENT_SCHEMA = 'solat.voice-provider-event.v1';
const AUDIO_ENCODINGS = new Set(['pcm_f32le', 'pcm_s16le']);
const MAX_AUDIO_CHUNK_BYTES = 256 * 1024;
const MAX_TTS_CHARACTERS = 12_000;
const MAX_TTS_AUDIO_BYTES = 16 * 1024 * 1024;

function voiceError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requiredText(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw voiceError(code, message);
  return normalized;
}

function normalizedLanguage(value) {
  const language = String(value || '').trim().toLowerCase();
  if (!language || language === 'auto') return undefined;
  return language.split(/[-_]/u)[0];
}

class CartesiaSTTProvider {
  constructor({ config, clientFactory = options => new Cartesia(options) }) {
    this.config = config;
    this.clientFactory = clientFactory;
    this.sessions = new Map();
  }

  status() {
    return Object.freeze({
      provider: 'cartesia',
      model: this.config.sttModel,
      configured: Boolean(this.config.enabled && this.config.provider === 'cartesia' && this.config.apiKey),
      streaming: true,
    });
  }

  start({ sessionId, sampleRate, encoding = 'pcm_f32le', onEvent }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    if (!this.status().configured) throw voiceError('voice_not_configured', 'Cartesia voice is not configured.');
    if (this.sessions.has(id)) throw voiceError('voice_session_active', 'This voice session is already listening.');
    const rate = Number(sampleRate);
    if (!Number.isInteger(rate) || rate < 8_000 || rate > 96_000) throw voiceError('invalid_audio_format', 'The microphone sample rate is invalid.');
    if (!AUDIO_ENCODINGS.has(encoding)) throw voiceError('invalid_audio_format', 'The microphone encoding is not supported.');
    if (typeof onEvent !== 'function') throw voiceError('invalid_voice_listener', 'A voice event listener is required.');

    const client = this.clientFactory({ apiKey: this.config.apiKey, timeout: this.config.timeoutMs, maxRetries: 0 });
    const socket = client.stt.autoFinalize.websocket({
      model: this.config.sttModel,
      encoding,
      sample_rate: rate,
      turn_end_timeout_ms: this.config.turnEndTimeoutMs,
    }, { reconnect: null });
    const session = { id, socket, closed: false, finalCount: 0, onEvent };
    this.sessions.set(id, session);
    socket.on('error', error => {
      if (session.closed) return;
      onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'error', session_id: id, code: 'stt_provider_error', message: error?.message || 'Speech recognition failed.' });
    });
    session.consumer = this.#consume(session);
    return Object.freeze({ sessionId: id, provider: 'cartesia', model: this.config.sttModel });
  }

  async #consume(session) {
    try {
      for await (const event of session.socket.stream()) {
        if (session.closed) break;
        if (event.type === 'error') {
          session.onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'error', session_id: session.id, code: 'stt_provider_error', message: event.error?.message || 'Speech recognition failed.' });
          continue;
        }
        if (event.type !== 'message') continue;
        const message = event.message || {};
        if (message.type === 'turn.start') {
          session.onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'speech_start', session_id: session.id });
        } else if (message.type === 'turn.update' || message.type === 'turn.eager_end') {
          session.onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'partial', session_id: session.id, transcript: String(message.transcript || '') });
        } else if (message.type === 'turn.resume') {
          session.onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'speech_resume', session_id: session.id });
        } else if (message.type === 'turn.end') {
          const transcript = String(message.transcript || '').trim();
          if (!transcript) continue;
          session.finalCount += 1;
          session.onEvent({
            schema_version: VOICE_EVENT_SCHEMA,
            type: 'final',
            session_id: session.id,
            utterance_id: `${session.id}:${session.finalCount}`,
            transcript,
          });
        }
      }
    } catch (error) {
      if (!session.closed) session.onEvent({ schema_version: VOICE_EVENT_SCHEMA, type: 'error', session_id: session.id, code: 'stt_provider_error', message: error?.message || 'Speech recognition failed.' });
    } finally {
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    }
  }

  push({ sessionId, bytes }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    const session = this.sessions.get(id);
    if (!session || session.closed) throw voiceError('voice_session_inactive', 'This voice session is not listening.');
    const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!chunk.byteLength || chunk.byteLength > MAX_AUDIO_CHUNK_BYTES) throw voiceError('invalid_audio_chunk', 'The microphone audio chunk is invalid.');
    session.socket.sendRaw(chunk);
  }

  stop({ sessionId }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    const session = this.sessions.get(id);
    if (!session || session.closed) return false;
    session.socket.send({ type: 'close' });
    return true;
  }

  cancel({ sessionId }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    const session = this.sessions.get(id);
    if (!session) return false;
    session.closed = true;
    this.sessions.delete(id);
    session.socket.close({ code: 1000, reason: 'cancelled' });
    return true;
  }

  dispose() {
    for (const session of [...this.sessions.values()]) this.cancel({ sessionId: session.id });
  }
}

class CartesiaTTSProvider {
  constructor({ config, clientFactory = options => new Cartesia(options) }) {
    this.config = config;
    this.clientFactory = clientFactory;
    this.active = new Map();
  }

  status() {
    return Object.freeze({
      provider: 'cartesia',
      model: this.config.ttsModel,
      voiceIdConfigured: Boolean(this.config.voiceId),
      configured: Boolean(this.config.enabled && this.config.provider === 'cartesia' && this.config.apiKey && this.config.voiceId),
      streaming: false,
    });
  }

  async speak({ sessionId, text, language }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    const transcript = requiredText(text, 'invalid_tts_text', 'Visible assistant text is required for speech.');
    if (transcript.length > MAX_TTS_CHARACTERS) throw voiceError('tts_text_too_long', 'The assistant response is too long to speak safely.');
    if (!this.status().configured) throw voiceError('voice_not_configured', 'Cartesia voice and voice id are not configured.');
    this.cancel({ sessionId: id });
    const controller = new AbortController();
    this.active.set(id, controller);
    const client = this.clientFactory({ apiKey: this.config.apiKey, timeout: this.config.timeoutMs, maxRetries: 0 });
    const selectedLanguage = normalizedLanguage(this.config.language) || normalizedLanguage(language);
    try {
      const response = await client.tts.generate({
        model_id: this.config.ttsModel,
        transcript,
        voice: this.config.voiceId,
        output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: this.config.ttsSampleRate },
        ...(selectedLanguage ? { language: selectedLanguage } : {}),
      }, { signal: controller.signal });
      if (controller.signal.aborted) throw voiceError('tts_cancelled', 'Speech was cancelled.');
      const contentLength = Number(response?.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_TTS_AUDIO_BYTES) {
        throw voiceError('tts_audio_too_large', 'The speech provider returned more audio than SOLAT can safely buffer.');
      }
      const audio = new Uint8Array(await response.arrayBuffer());
      if (controller.signal.aborted) throw voiceError('tts_cancelled', 'Speech was cancelled.');
      if (!audio.byteLength) throw voiceError('malformed_tts_response', 'The speech provider returned no audio.');
      if (audio.byteLength > MAX_TTS_AUDIO_BYTES) throw voiceError('tts_audio_too_large', 'The speech provider returned more audio than SOLAT can safely buffer.');
      return Object.freeze({ sessionId: id, mimeType: 'audio/wav', audio, provider: 'cartesia', model: this.config.ttsModel });
    } catch (error) {
      if (controller.signal.aborted) throw voiceError('tts_cancelled', 'Speech was cancelled.');
      if (error?.code) throw error;
      throw voiceError('tts_provider_error', error?.message || 'Speech generation failed.');
    } finally {
      if (this.active.get(id) === controller) this.active.delete(id);
    }
  }

  cancel({ sessionId }) {
    const id = requiredText(sessionId, 'invalid_voice_session', 'A voice session id is required.');
    const controller = this.active.get(id);
    if (!controller) return false;
    this.active.delete(id);
    controller.abort();
    return true;
  }

  dispose() {
    for (const id of [...this.active.keys()]) this.cancel({ sessionId: id });
  }
}

class VoiceService {
  constructor({ sttProvider, ttsProvider }) {
    this.sttProvider = sttProvider;
    this.ttsProvider = ttsProvider;
  }

  status() {
    return Object.freeze({ schemaVersion: 'solat.voice-status.v1', stt: this.sttProvider.status(), tts: this.ttsProvider.status() });
  }

  startSTT(request) { return this.sttProvider.start(request); }
  pushSTT(request) { return this.sttProvider.push(request); }
  stopSTT(request) { return this.sttProvider.stop(request); }
  cancelSTT(request) { return this.sttProvider.cancel(request); }
  speak(request) { return this.ttsProvider.speak(request); }
  cancelTTS(request) { return this.ttsProvider.cancel(request); }
  dispose() { this.sttProvider.dispose(); this.ttsProvider.dispose(); }
}

function createVoiceService(config, options = {}) {
  const voiceConfig = config.voice;
  return new VoiceService({
    sttProvider: new CartesiaSTTProvider({ config: voiceConfig, clientFactory: options.clientFactory }),
    ttsProvider: new CartesiaTTSProvider({ config: voiceConfig, clientFactory: options.clientFactory }),
  });
}

module.exports = {
  AUDIO_ENCODINGS,
  CartesiaSTTProvider,
  CartesiaTTSProvider,
  MAX_AUDIO_CHUNK_BYTES,
  VOICE_EVENT_SCHEMA,
  VoiceService,
  createVoiceService,
};
