const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePcm16Wav, runLiveVoiceSmoke } = require('../scripts/smoke-voice-live');

function pcmWav(samples = Uint8Array.from([1, 0, 2, 0]), sampleRate = 24000) {
  const output = Buffer.alloc(44 + samples.length);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVE', 8);
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write('data', 36); output.writeUInt32LE(samples.length, 40); Buffer.from(samples).copy(output, 44);
  return output;
}

test('live voice smoke WAV parser accepts bounded mono PCM16 and rejects malformed output', () => {
  const parsed = parsePcm16Wav(pcmWav());
  assert.equal(parsed.sampleRate, 24000);
  assert.deepEqual([...parsed.audio], [1, 0, 2, 0]);
  const streaming = pcmWav();
  streaming.writeUInt32LE(0xffffffff, 4);
  streaming.writeUInt32LE(0xffffffff, 40);
  assert.deepEqual([...parsePcm16Wav(streaming).audio], [1, 0, 2, 0]);
  assert.throws(() => parsePcm16Wav(Buffer.from('not wav')), error => error.code === 'invalid_voice_wav');
});

test('live voice smoke reports missing local credentials without contacting a provider', async () => {
  const disposed = [];
  const voiceService = {
    status: () => ({ stt: { provider: 'cartesia', model: 'ink-2', configured: false }, tts: { model: 'sonic-latest', voiceIdConfigured: false, configured: false } }),
    dispose: () => disposed.push(true),
  };
  const report = await runLiveVoiceSmoke({ voiceService });
  assert.equal(report.outcome, 'NOT VERIFIED');
  assert.match(report.blocker, /API key and voice id/);
  assert.deepEqual(disposed, []);
});

test('packaged silent runtime evidence is bounded, redacted and explicit about acoustic limitations', () => {
  const reportPath = path.join(__dirname, '..', 'reports', 'voice-packaged-silent-v1-20260823.json');
  const serialized = fs.readFileSync(reportPath, 'utf8');
  const report = JSON.parse(serialized);
  assert.equal(report.schema_version, 'solat.voice-packaged-silent-runtime.v1');
  assert.equal(report.outcome, 'PASS');
  assert.equal(report.microphone_capture.status, 'PASS');
  assert.equal(report.microphone_capture.processor_frames, 18);
  assert.equal(report.microphone_capture.non_zero_frames, 18);
  assert.equal(report.microphone_capture.secure_ipc_stt_pushes, 15);
  assert.equal(report.microphone_capture.secure_ipc_pcm_bytes, 288000);
  assert.equal(report.automatic_barge_in.status, 'PASS');
  assert.equal(report.automatic_barge_in.calls.tts_cancel, 1);
  assert.equal(report.automatic_barge_in.calls.stt_cancel, 1);
  assert.equal(report.automatic_barge_in.conversation_preserved, true);
  assert.equal(report.automatic_barge_in.voice_session_rotated, true);
  assert.equal(report.automatic_barge_in.audio_constructor_calls, 0);
  assert.equal(report.automatic_barge_in.audio_play_calls, 0);
  assert.equal(report.cleanup.track_ready_state, 'ended');
  assert.equal(report.cleanup.audio_context_state, 'closed');
  assert.match(report.limitations.join(' '), /speaker.*NOT VERIFIED|speaker output remain NOT VERIFIED/i);
  assert.doesNotMatch(serialized, /groupId|authorization|bearer\s|api.?key|cookie|password|sk-[A-Za-z0-9]/i);
});

test('packaged integrated voice evidence proves one silent STT to Chat to TTS turn without overclaiming acoustics', () => {
  const reportPath = path.join(__dirname, '..', 'reports', 'voice-packaged-e2e-v1-20260823.json');
  const serialized = fs.readFileSync(reportPath, 'utf8');
  const report = JSON.parse(serialized);
  assert.equal(report.schema_version, 'solat.voice-packaged-e2e.v1');
  assert.equal(report.outcome, 'PASS');
  assert.equal(report.runtime.configured, true);
  assert.equal(report.runtime.input.method, 'synthetic_cartesia_tts_pcm_injected_into_production_audio_callback');
  assert.equal(report.runtime.input.raw_audio_persisted, false);
  assert.ok(report.runtime.transcript);
  assert.equal(report.runtime.transcript_utterance_id_present, true);
  assert.equal(report.runtime.seed_transcript_exact_match, false);
  assert.equal(report.runtime.chat.user_message_matches_final, true);
  assert.equal(report.runtime.chat.user_dom_visible_present, true);
  assert.equal(report.runtime.chat.user_dom_matches_final, true);
  assert.equal(report.runtime.chat.assistant_visible_present, true);
  assert.ok(report.runtime.chat.assistant_source_chars > 0);
  assert.ok(report.runtime.chat.assistant_dom_rendered_chars > 0);
  assert.match(report.runtime.chat.assistant_source_sha256, /^[A-F0-9]{64}$/u);
  assert.equal(report.runtime.chat.tts_request_matches_assistant_source, true);
  assert.equal(report.runtime.chat.assistant_error_count, 0);
  assert.equal(report.runtime.trace.bridge.tts_speaks, 1);
  assert.equal(report.runtime.trace.bridge.tts_requests.length, 1);
  assert.equal(report.runtime.trace.bridge.tts_requests[0].text_chars, report.runtime.chat.assistant_source_chars);
  assert.equal(report.runtime.trace.bridge.tts_requests[0].text_sha256, report.runtime.chat.assistant_source_sha256);
  assert.ok(report.runtime.trace.bridge.tts_bytes > 0);
  assert.deepEqual(report.runtime.trace.bridge.tts_results.map(result => result.riff_wave), [true]);
  assert.equal(report.runtime.trace.audio.constructors, 1);
  assert.equal(report.runtime.trace.audio.play_calls, 1);
  assert.equal(report.seed.speaker_playback, false);
  assert.equal(report.runtime.conversation_id_preserved, true);
  assert.equal(report.runtime.final_voice_session_rotated, true);
  assert.equal(report.runtime.final_state, 'listening');
  assert.equal(report.cleanup.controller_idle, true);
  assert.equal(report.cleanup.track_ended, true);
  assert.equal(report.cleanup.audio_context_closed, true);
  assert.equal(report.cleanup.process_exited, true);
  assert.equal(report.cleanup.profile_removed, true);
  assert.equal(report.privacy.api_key_persisted, false);
  assert.equal(report.privacy.raw_pcm_persisted, false);
  assert.equal(report.privacy.assistant_text_persisted, false);
  assert.match(report.limitations.join(' '), /Audible speaker output.*remain NOT VERIFIED/iu);
  assert.match(report.limitations.join(' '), /partially transcribed.*accuracy remains NOT VERIFIED/iu);
  assert.match(report.limitations.join(' '), /assistant source exactly.*Markdown.*display/iu);
  assert.doesNotMatch(serialized, /"(?:authorization|cookie|password)"\s*:|bearer\s+|sk-[A-Za-z0-9]/iu);
});
