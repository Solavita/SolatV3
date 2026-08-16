const crypto = require('node:crypto');

const TARGET_ATTESTATION_SCHEMA_VERSION = 'solat.computer-target-attestation.v1';

class TargetAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetAttestationError';
    this.code = code;
  }
}

function integer(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TargetAttestationError('invalid_attestation', `${field} must be a positive integer.`);
  }
  return number;
}

function text(value, field, max) {
  const result = String(value || '').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new TargetAttestationError('invalid_attestation', `${field} is invalid.`);
  }
  return result;
}

function normalizedTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TargetAttestationError('invalid_attestation', 'A trusted target is required.');
  }
  return {
    hwnd: integer(target.hwnd, 'hwnd'),
    process_id: integer(target.process_id ?? target.processId, 'process_id'),
    process_name: text(target.process_name ?? target.processName, 'process_name', 120).toLocaleLowerCase(),
    window_title: text(target.window_title ?? target.title, 'window_title', 300),
  };
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function createTargetAttestation({ revision, target, screenSha256 = null } = {}) {
  const record = {
    schema_version: TARGET_ATTESTATION_SCHEMA_VERSION,
    revision: integer(revision, 'revision'),
    target: normalizedTarget(target),
    screen_sha256: screenSha256 === null ? null : text(screenSha256, 'screen_sha256', 71),
  };
  if (record.screen_sha256 !== null && !/^sha256:[a-f0-9]{64}$/u.test(record.screen_sha256)) {
    throw new TargetAttestationError('invalid_attestation', 'screen_sha256 is invalid.');
  }
  return Object.freeze({ ...record, fingerprint: fingerprint(record) });
}

function assertCurrentTarget({ attestation, revision, currentTarget, currentScreenSha256 = null, sensitive = false } = {}) {
  if (!attestation || attestation.schema_version !== TARGET_ATTESTATION_SCHEMA_VERSION) {
    throw new TargetAttestationError('invalid_attestation', 'The approved target attestation is missing or unsupported.');
  }
  const unsigned = {
    schema_version: attestation.schema_version,
    revision: attestation.revision,
    target: attestation.target,
    screen_sha256: attestation.screen_sha256 ?? null,
  };
  if (fingerprint(unsigned) !== attestation.fingerprint) {
    throw new TargetAttestationError('attestation_integrity_error', 'The approved target attestation was modified.');
  }
  if (integer(revision, 'revision') !== integer(attestation.revision, 'revision')) {
    throw new TargetAttestationError('stale_revision', 'The approval belongs to an older computer-task revision.');
  }
  if (sensitive) {
    throw new TargetAttestationError('sensitive_target', 'The current window or element is sensitive and cannot be controlled.');
  }
  const current = normalizedTarget(currentTarget);
  const expected = normalizedTarget(attestation.target);
  if (current.hwnd !== expected.hwnd
    || current.process_id !== expected.process_id
    || current.process_name !== expected.process_name) {
    throw new TargetAttestationError('target_identity_changed', 'The approved HWND now belongs to a different application or process.');
  }
  // A different title commonly means that the user changed tabs/pages while
  // approval was open. Fail closed and re-observe instead of applying an old
  // selector to new content.
  if (current.window_title !== expected.window_title) {
    throw new TargetAttestationError('target_state_changed', 'The approved window changed before execution.');
  }
  if (attestation.screen_sha256 !== null) {
    if (currentScreenSha256 === null
      || text(currentScreenSha256, 'current_screen_sha256', 71) !== attestation.screen_sha256) {
      throw new TargetAttestationError('target_state_changed', 'The approved screen observation is missing or changed before execution.');
    }
  }
  return Object.freeze({ ...current });
}

module.exports = {
  TARGET_ATTESTATION_SCHEMA_VERSION,
  TargetAttestationError,
  assertCurrentTarget,
  createTargetAttestation,
};
