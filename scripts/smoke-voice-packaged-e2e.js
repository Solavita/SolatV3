#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseDotEnv } = require('../src/core/config');

const ROOT = path.resolve(__dirname, '..');
const FINAL_EXE = path.join(ROOT, 'dist-verified-20260823-voice-v1-final', 'win-unpacked', 'SOLAT.exe');
const FINAL_ASAR = path.join(path.dirname(FINAL_EXE), 'resources', 'app.asar');
const PROFILE = path.join(ROOT, 'artifacts', 'voice-v1-final-e2e-user-data');
const OUTPUT = path.join(ROOT, 'reports', 'voice-packaged-e2e-v1-20260823.json');
const PORT = 9224;
const SEED_TEXT = 'Please reply with exactly: Voice loop complete.';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const textHash = value => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').toUpperCase();

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timed out.')), 10_000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed.')); }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP request failed.'));
      else pending.resolve(message.result);
    });
    const rejectPending = message => {
      for (const pending of this.pending.values()) pending.reject(new Error(message));
      this.pending.clear();
    };
    this.socket.addEventListener('close', () => rejectPending('CDP connection closed before evaluation completed.'), { once: true });
    this.socket.addEventListener('error', () => rejectPending('CDP connection failed during evaluation.'), { once: true });
  }
  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket?.close(); } catch {} }
}

function invoke(fn, ...args) { return `(${fn.toString()})(...${JSON.stringify(args)})`; }

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed.');
  }
  return response.result?.value;
}

async function waitForPage() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      const page = targets.find(item => item.type === 'page' && /renderer[\\/]index\.html|SOLAT/iu.test(`${item.url} ${item.title}`));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Packaged SOLAT renderer was not available on the localhost test port.');
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null) return true;
  return Promise.race([
    new Promise(resolve => child.once('close', () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ]);
}

async function removeProfile() {
  const resolved = path.resolve(PROFILE);
  const root = path.resolve(ROOT, 'artifacts');
  if (path.dirname(resolved) !== root || path.basename(resolved) !== 'voice-v1-final-e2e-user-data') {
    throw new Error('Refusing to remove an unexpected profile path.');
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.promises.rm(resolved, { recursive: true, force: true });
      if (!fs.existsSync(resolved)) return true;
    } catch {}
    await sleep(500);
  }
  return !fs.existsSync(resolved);
}

function loadLocalEnvironment() {
  const envPath = path.join(ROOT, '.env');
  const values = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
  return { ...process.env, ...values, SOLAT_DEVTOOLS: '0' };
}

async function main() {
  if (!fs.existsSync(FINAL_EXE) || !fs.existsSync(FINAL_ASAR)) throw new Error('Final packaged Voice V1 build is missing.');
  if (fs.existsSync(OUTPUT)) throw new Error(`Evidence file already exists: ${OUTPUT}`);
  await removeProfile();
  const startedAt = new Date().toISOString();
  const child = spawn(FINAL_EXE, [
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`,
  ], {
    cwd: path.dirname(FINAL_EXE),
    env: loadLocalEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processLogs = [];
  const collectLog = chunk => processLogs.push(...String(chunk).split(/\r?\n/u).filter(Boolean).slice(-20));
  child.stdout.on('data', collectLog);
  child.stderr.on('data', collectLog);
  const keepAlive = setInterval(() => {}, 1_000);
  let client = null;
  let runtime = null;
  let cleanup = null;
  let failure = null;
  try {
    const page = await waitForPage();
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    const readyDeadline = Date.now() + 20_000;
    while (Date.now() < readyDeadline) {
      const ready = await evaluate(client, invoke(() => Boolean(window.solatVoiceController && window.solat?.voiceStatus && document.querySelector('#log'))));
      if (ready) break;
      await sleep(200);
    }
    runtime = await evaluate(client, invoke(async seedText => {
      const controller = window.solatVoiceController;
      if (!controller) throw new Error('Voice controller is unavailable.');
      const original = {
        bridge: controller.bridge,
        AudioClass: controller.AudioClass,
        onState: controller.onState,
        onError: controller.onError,
        onFinalTranscript: controller.onFinalTranscript,
      };
      const trace = {
        started_at_ms: performance.now(),
        states: [],
        errors: [],
        final_transcripts: [],
        bridge: { stt_starts: 0, stt_pushes: 0, stt_bytes: 0, stt_stops: 0, tts_speaks: 0, tts_bytes: 0, tts_requests: [], tts_results: [] },
        audio: { constructors: 0, play_calls: 0 },
      };
      const delegate = window.solat;
      controller.bridge = {
        voiceStatus: (...args) => delegate.voiceStatus(...args),
        voiceStartSTT: async request => { trace.bridge.stt_starts += 1; return delegate.voiceStartSTT(request); },
        voicePushSTT: async request => {
          trace.bridge.stt_pushes += 1;
          trace.bridge.stt_bytes += Number(request?.bytes?.byteLength || 0);
          return delegate.voicePushSTT(request);
        },
        voiceStopSTT: async request => { trace.bridge.stt_stops += 1; return delegate.voiceStopSTT(request); },
        voiceCancelSTT: (...args) => delegate.voiceCancelSTT(...args),
        voiceSpeak: async request => {
          trace.bridge.tts_speaks += 1;
          const requestText = String(request?.text || '');
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestText));
          trace.bridge.tts_requests.push({
            text_chars: requestText.length,
            text_sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(),
            language: String(request?.language || ''),
          });
          const result = await delegate.voiceSpeak(request);
          const audio = result?.audio instanceof Uint8Array ? result.audio : new Uint8Array(result?.audio || []);
          trace.bridge.tts_bytes += audio.byteLength;
          trace.bridge.tts_results.push({
            mime_type: String(result?.mimeType || ''),
            bytes: audio.byteLength,
            riff_wave: audio.byteLength >= 12
              && String.fromCharCode(...audio.slice(0, 4)) === 'RIFF'
              && String.fromCharCode(...audio.slice(8, 12)) === 'WAVE',
          });
          return result;
        },
        voiceCancelTTS: (...args) => delegate.voiceCancelTTS(...args),
        voiceDispose: (...args) => delegate.voiceDispose(...args),
        onVoiceEvent: listener => delegate.onVoiceEvent(listener),
      };
      controller.AudioClass = class SilentAudio {
        constructor() { trace.audio.constructors += 1; this.src = ''; this.onended = null; this.onerror = null; }
        play() { trace.audio.play_calls += 1; setTimeout(() => this.onended?.(), 25); return Promise.resolve(); }
        pause() {}
      };
      controller.onState = (state, detail = {}) => {
        trace.states.push({ state, at_ms: performance.now() - trace.started_at_ms, pending_audio: detail?.pendingAudio === true });
        original.onState(state, detail);
      };
      controller.onError = error => {
        trace.errors.push({ code: String(error?.code || 'voice_error'), message: String(error?.message || 'Voice error').slice(0, 160) });
        original.onError(error);
      };
      controller.onFinalTranscript = async (transcript, utteranceId) => {
        trace.final_transcripts.push({ transcript: String(transcript), utterance_id_present: Boolean(utteranceId), at_ms: performance.now() - trace.started_at_ms });
        return original.onFinalTranscript(transcript, utteranceId);
      };
      const restore = () => {
        controller.bridge = original.bridge;
        controller.AudioClass = original.AudioClass;
        controller.onState = original.onState;
        controller.onError = original.onError;
        controller.onFinalTranscript = original.onFinalTranscript;
      };
      window.__voiceE2ERestore = restore;
      window.__voiceE2ETrace = trace;
      await new Promise(resolve => setTimeout(resolve, 3500));
      document.querySelector('#newChatBtn')?.click();
      await new Promise(resolve => setTimeout(resolve, 600));
      await delegate.setModelMode('deepseek');
      const status = await delegate.status();
      const voiceStatus = await delegate.voiceStatus();
      const initialSavedState = JSON.parse(localStorage.getItem('solat.v2.threads') || 'null');
      const testThreadId = String(initialSavedState?.activeId || '');
      if (!testThreadId) throw new Error('Fresh test conversation was not persisted.');
      const conversationId = `voice-e2e-${Date.now()}`;
      localStorage.setItem(`solat.v2.creative.session.${testThreadId}`, JSON.stringify(conversationId));
      await controller.enter(conversationId);
      const initialVoiceSessionId = controller.voiceSessionId;
      const track = controller.stream?.getAudioTracks?.()[0] || null;
      const inputSettings = track?.getSettings?.() || {};
      controller.source?.disconnect?.();
      if (track) track.enabled = false;
      const seedSessionId = `${conversationId}:seed`;
      const seed = await delegate.voiceSpeak({ sessionId: seedSessionId, text: seedText, language: 'en' });
      await delegate.voiceDispose({ sessionId: seedSessionId });
      const wav = seed?.audio instanceof Uint8Array ? seed.audio : new Uint8Array(seed?.audio || []);
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let offset = 12;
      let channels = 1;
      let sourceRate = 0;
      let bits = 0;
      let audioFormat = 0;
      let dataOffset = 0;
      let dataLength = 0;
      while (offset + 8 <= view.byteLength) {
        const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        const size = view.getUint32(offset + 4, true);
        if (id === 'fmt ') {
          audioFormat = view.getUint16(offset + 8, true);
          channels = view.getUint16(offset + 10, true);
          sourceRate = view.getUint32(offset + 12, true);
          bits = view.getUint16(offset + 22, true);
        } else if (id === 'data') {
          dataOffset = offset + 8;
          dataLength = Math.min(size, view.byteLength - dataOffset);
          break;
        }
        offset += 8 + size + (size % 2);
      }
      if (audioFormat !== 1 || bits !== 16 || !dataOffset || !sourceRate) throw new Error('Seed TTS did not return supported PCM16 WAV audio.');
      const sourceFrames = Math.floor(dataLength / (channels * 2));
      const source = new Float32Array(sourceFrames);
      for (let frame = 0; frame < sourceFrames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) sum += view.getInt16(dataOffset + ((frame * channels + channel) * 2), true) / 32768;
        source[frame] = sum / channels;
      }
      const targetRate = controller.audioContext.sampleRate;
      const target = new Float32Array(Math.max(1, Math.round(source.length * targetRate / sourceRate)));
      for (let index = 0; index < target.length; index += 1) {
        const position = index * sourceRate / targetRate;
        const left = Math.min(source.length - 1, Math.floor(position));
        const right = Math.min(source.length - 1, left + 1);
        const fraction = position - left;
        target[index] = source[left] + ((source[right] - source[left]) * fraction);
      }
      const processor = controller.processor;
      const frameSize = 4096;
      for (let offsetFrames = 0; offsetFrames < target.length; offsetFrames += frameSize) {
        const frame = new Float32Array(frameSize);
        frame.set(target.subarray(offsetFrames, Math.min(target.length, offsetFrames + frameSize)));
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => frame } });
        await new Promise(resolve => setTimeout(resolve, Math.ceil(frameSize / targetRate * 1000)));
      }
      const silenceFrames = Math.ceil(1800 / (frameSize / targetRate * 1000));
      for (let index = 0; index < silenceFrames; index += 1) {
        const frame = new Float32Array(frameSize);
        processor.onaudioprocess({ inputBuffer: { getChannelData: () => frame } });
        await new Promise(resolve => setTimeout(resolve, Math.ceil(frameSize / targetRate * 1000)));
      }
      const deadline = performance.now() + 120_000;
      let assistantText = '';
      let assistantSourceText = '';
      while (performance.now() < deadline) {
        const assistantBubbles = [...document.querySelectorAll('#stream article.msg.assistant:not(.error) .bubble')];
        assistantText = assistantBubbles.at(-1)?.innerText?.trim() || '';
        const persisted = JSON.parse(localStorage.getItem('solat.v2.threads') || 'null');
        const persistedThread = persisted?.threads?.find(item => item.id === testThreadId) || null;
        assistantSourceText = String([...(persistedThread?.messages || [])].reverse().find(message => message.role === 'assistant' && !message.error)?.content || '');
        if (trace.final_transcripts.length && assistantText && assistantSourceText && trace.bridge.tts_speaks >= 1 && ['listening', 'user_speaking'].includes(controller.state)) break;
        if (trace.errors.length) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const userBubbles = [...document.querySelectorAll('#stream article.msg.user .bubble')];
      const userText = userBubbles.at(-1)?.innerText?.trim() || '';
      const assistantErrorCount = document.querySelectorAll('#stream article.msg.assistant.error').length;
      const savedState = JSON.parse(localStorage.getItem('solat.v2.threads') || 'null');
      const savedThread = savedState?.threads?.find(item => item.id === testThreadId) || null;
      const userSourceText = String([...(savedThread?.messages || [])].reverse().find(message => message.role === 'user')?.content || '');
      assistantSourceText = String([...(savedThread?.messages || [])].reverse().find(message => message.role === 'assistant' && !message.error)?.content || '');
      const result = {
        configured: Boolean(voiceStatus?.stt?.configured && voiceStatus?.tts?.configured),
        model_mode: status?.modelMode || null,
        model_provider: status?.provider || null,
        conversation_id_preserved: controller.conversationSessionId === conversationId,
        initial_voice_session_id_present: Boolean(initialVoiceSessionId),
        final_voice_session_rotated: Boolean(controller.voiceSessionId && controller.voiceSessionId !== initialVoiceSessionId),
        input: {
          method: 'synthetic_cartesia_tts_pcm_injected_into_production_audio_callback',
          physical_track_was_acquired: Boolean(track),
          physical_track_initial_state: track?.readyState || null,
          audio_context_state: controller.audioContext?.state || null,
          target_sample_rate_hz: targetRate,
          source_sample_rate_hz: sourceRate,
          source_pcm_frames: source.length,
          injected_pcm_frames: target.length + silenceFrames * frameSize,
          raw_audio_persisted: false,
        },
        transcript: trace.final_transcripts.at(-1)?.transcript || null,
        transcript_utterance_id_present: trace.final_transcripts.at(-1)?.utterance_id_present || false,
        final_transcript_at_ms_from_trace_start: trace.final_transcripts.at(-1)?.at_ms || null,
        seed_transcript_exact_match: trace.final_transcripts.at(-1)?.transcript === seedText,
        chat: {
          user_message_present: Boolean(userSourceText),
          user_message_matches_final: Boolean(userSourceText && userSourceText === trace.final_transcripts.at(-1)?.transcript),
          user_dom_visible_present: Boolean(userText),
          user_dom_matches_final: Boolean(userText && userText === trace.final_transcripts.at(-1)?.transcript),
          assistant_visible_present: Boolean(assistantText && assistantSourceText),
          assistant_source_chars: assistantSourceText.length,
          assistant_dom_rendered_chars: assistantText.length,
          assistant_source_sha256: null,
          assistant_error_count: assistantErrorCount,
        },
        trace,
        final_state: controller.state,
        active_before_cleanup: controller.active,
      };
      result.chat.assistant_source_text = assistantSourceText;
      return result;
    }, SEED_TEXT));
  } catch (error) {
    failure = { code: error.code || 'packaged_voice_e2e_failed', message: String(error.message || error).slice(0, 240) };
  } finally {
    if (client) {
      try {
        cleanup = await evaluate(client, invoke(async () => {
          const controller = window.solatVoiceController;
          const track = controller?.stream?.getAudioTracks?.()[0] || null;
          const context = controller?.audioContext || null;
          await controller?.exit?.();
          window.__voiceE2ERestore?.();
          delete window.__voiceE2ERestore;
          delete window.__voiceE2ETrace;
          return {
            controller_idle: controller?.state === 'idle',
            controller_inactive: controller?.active === false,
            stream_released: controller?.stream === null,
            audio_context_released: controller?.audioContext === null,
            track_ended: !track || track.readyState === 'ended',
            audio_context_closed: !context || context.state === 'closed',
            bridge_restored: controller?.bridge === window.solat,
          };
        }));
      } catch (error) {
        cleanup = { error: String(error.message || error).slice(0, 160) };
      }
      try { await client.send('Browser.close'); } catch {}
      client.close();
    }
    if (!await waitForExit(child, 8_000) && child.exitCode === null) child.kill();
    await waitForExit(child, 5_000);
    const profileRemoved = await removeProfile();
    cleanup = { ...(cleanup || {}), process_exited: child.exitCode !== null, profile_removed: profileRemoved };
    clearInterval(keepAlive);
  }

  const assistantText = runtime?.chat?.assistant_source_text || '';
  if (runtime?.chat) {
    runtime.chat.assistant_source_sha256 = assistantText ? textHash(assistantText) : null;
    delete runtime.chat.assistant_source_text;
    const ttsRequest = runtime.trace?.bridge?.tts_requests?.[0];
    runtime.chat.tts_request_matches_assistant_source = Boolean(ttsRequest
      && ttsRequest.text_chars === runtime.chat.assistant_source_chars
      && ttsRequest.text_sha256 === runtime.chat.assistant_source_sha256);
  }
  const passed = !failure
    && runtime?.configured
    && runtime?.transcript
    && runtime?.transcript_utterance_id_present
    && runtime?.chat?.user_message_matches_final
    && runtime?.chat?.user_dom_matches_final
    && runtime?.chat?.assistant_visible_present
    && runtime?.chat?.tts_request_matches_assistant_source
    && runtime?.chat?.assistant_error_count === 0
    && runtime?.trace?.bridge?.tts_speaks === 1
    && runtime?.trace?.bridge?.tts_bytes > 0
    && runtime?.trace?.audio?.constructors === 1
    && runtime?.trace?.audio?.play_calls === 1
    && ['listening', 'user_speaking'].includes(runtime?.final_state)
    && cleanup?.controller_idle
    && cleanup?.controller_inactive
    && cleanup?.stream_released
    && cleanup?.audio_context_released
    && cleanup?.track_ended
    && cleanup?.audio_context_closed
    && cleanup?.bridge_restored
    && cleanup?.process_exited
    && cleanup?.profile_removed;
  const report = {
    schema_version: 'solat.voice-packaged-e2e.v1',
    outcome: passed ? 'PASS' : 'FAIL',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    package: {
      executable: FINAL_EXE,
      executable_sha256: sha256(FINAL_EXE),
      app_asar_sha256: sha256(FINAL_ASAR),
      localhost_cdp_port: PORT,
      runtime_test_flags_only: true,
    },
    seed: { text: SEED_TEXT, generated_by: 'cartesia_tts', speaker_playback: false },
    runtime,
    cleanup,
    failure: failure ? { ...failure, process_log_lines: processLogs.length } : null,
    privacy: {
      api_key_persisted: false,
      raw_pcm_persisted: false,
      device_label_or_group_id_persisted: false,
      assistant_text_persisted: false,
    },
    limitations: [
      'The input utterance was generated by Cartesia TTS and injected into the production audio callback; it was not spoken by a person.',
      'The generated seed was only partially transcribed in this run; exact STT semantic accuracy remains NOT VERIFIED.',
      'The TTS request matches the persisted assistant source exactly; rendered DOM character count can differ because Markdown is normalized for display.',
      'Assistant TTS used the live provider, but playback was routed to a silent in-memory Audio implementation.',
      'Audible speaker output, acoustic echo cancellation, permission-dialog UX, device switching, subjective voice quality, and a physical multi-turn conversation remain NOT VERIFIED.',
    ],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ outcome: report.outcome, output: OUTPUT, failure, transcript: Boolean(runtime?.transcript), assistant: Boolean(runtime?.chat?.assistant_visible_present), tts_calls: runtime?.trace?.bridge?.tts_speaks || 0 })}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ outcome: 'FAIL', code: error.code || 'packaged_voice_e2e_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
