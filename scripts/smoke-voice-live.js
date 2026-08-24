#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('../src/core/config');
const { createVoiceService } = require('../src/core/voice-service');

const VERIFY_TEXT = 'Hello. This is the SOLAT voice verification.';

function parseOutputPath(argv) {
  const index = argv.indexOf('--output');
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

function parsePcm16Wav(value) {
  const bytes = Buffer.from(value);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw Object.assign(new Error('Cartesia TTS did not return a valid WAV container.'), { code: 'invalid_voice_wav' });
  }
  let offset = 12;
  let format = null;
  let audio = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const streamingLength = length === 0xffffffff;
    const end = streamingLength ? bytes.length : start + length;
    if (end > bytes.length) throw Object.assign(new Error('The voice WAV contains a truncated chunk.'), { code: 'invalid_voice_wav' });
    if (type === 'fmt ' && length >= 16) {
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (type === 'data') {
      audio = bytes.subarray(start, end);
      if (streamingLength) break;
    }
    offset = end + (length % 2);
  }
  if (!format || format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16 || !audio?.length) {
    throw Object.assign(new Error('The voice WAV must contain mono 16-bit PCM.'), { code: 'invalid_voice_wav' });
  }
  return Object.freeze({ sampleRate: format.sampleRate, audio: new Uint8Array(audio) });
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function runLiveVoiceSmoke({ config = readConfig(), voiceService = createVoiceService(config) } = {}) {
  const status = voiceService.status();
  const report = {
    schema_version: 'solat.voice-live-smoke.v1',
    created_at: new Date().toISOString(),
    provider: status.stt.provider,
    stt_model: status.stt.model,
    tts_model: status.tts.model,
    credentials_present: Boolean(status.stt.configured),
    voice_id_present: Boolean(status.tts.voiceIdConfigured),
    cases: [],
    outcome: 'NOT VERIFIED',
  };
  if (!status.stt.configured || !status.tts.configured) {
    report.blocker = 'Cartesia API key and voice id must both be configured locally.';
    return report;
  }

  const ttsSessionId = `voice-smoke-tts-${crypto.randomUUID()}`;
  const sttSessionId = `voice-smoke-stt-${crypto.randomUUID()}`;
  try {
    const ttsStarted = Date.now();
    const spoken = await voiceService.speak({ sessionId: ttsSessionId, text: VERIFY_TEXT, language: 'en' });
    const wav = parsePcm16Wav(spoken.audio);
    report.cases.push({
      id: 'cartesia-tts-wav',
      status: wav.audio.byteLength > 0 ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - ttsStarted,
      audio_bytes: wav.audio.byteLength,
      sample_rate: wav.sampleRate,
    });

    let settleFinal;
    const finalEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('Cartesia STT did not finalize in time.'), { code: 'stt_finalize_timeout' })), 15000);
      settleFinal = event => { clearTimeout(timer); resolve(event); };
    });
    const sttStarted = Date.now();
    const providerEvents = [];
    voiceService.startSTT({
      sessionId: sttSessionId,
      sampleRate: wav.sampleRate,
      encoding: 'pcm_s16le',
      onEvent: event => {
        providerEvents.push({ type: event.type, transcript: String(event.transcript || ''), code: event.code || null });
        if (event.type === 'final' && String(event.transcript || '').trim()) settleFinal(event);
      },
    });
    const chunkBytes = Math.max(2, Math.round(wav.sampleRate / 10) * 2);
    for (let offset = 0; offset < wav.audio.byteLength; offset += chunkBytes) {
      voiceService.pushSTT({ sessionId: sttSessionId, bytes: wav.audio.slice(offset, Math.min(offset + chunkBytes, wav.audio.byteLength)) });
      await wait(100);
    }
    const silence = new Uint8Array(chunkBytes);
    for (let count = 0; count < 14; count += 1) {
      voiceService.pushSTT({ sessionId: sttSessionId, bytes: silence });
      await wait(100);
    }
    const final = await finalEvent;
    const transcript = String(final.transcript || '').trim();
    const normalized = transcript.toLowerCase();
    const semanticMatch = normalized.includes('hello') && normalized.includes('voice') && /solat|solar|so lat/u.test(normalized);
    report.cases.push({
      id: 'cartesia-streaming-stt-final',
      status: semanticMatch ? 'PASS' : 'FAIL',
      elapsed_ms: Date.now() - sttStarted,
      transcript,
      utterance_id_present: Boolean(final.utterance_id),
      provider_events: providerEvents,
    });
    report.outcome = report.cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL';
    return report;
  } catch (error) {
    report.cases.push({ id: 'live-provider-error', status: 'FAIL', error: { code: error?.code || 'voice_live_error', message: error?.message || 'Live voice verification failed.' } });
    report.outcome = 'FAIL';
    return report;
  } finally {
    voiceService.cancelSTT({ sessionId: sttSessionId });
    voiceService.cancelTTS({ sessionId: ttsSessionId });
    voiceService.dispose();
  }
}

async function main() {
  if (!process.argv.includes('--execute')) throw new Error('Live Cartesia opt-in required: re-run with --execute.');
  const report = await runLiveVoiceSmoke();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destination = parseOutputPath(process.argv.slice(2));
  if (destination) {
    const absolute = path.resolve(process.cwd(), destination);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(serialized);
  process.exitCode = report.outcome === 'PASS' ? 0 : report.outcome === 'NOT VERIFIED' ? 2 : 1;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`Voice live smoke failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});

module.exports = { parsePcm16Wav, runLiveVoiceSmoke };
