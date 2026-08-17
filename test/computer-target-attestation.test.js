const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TargetAttestationError,
  assertCurrentTarget,
  createTargetAttestation,
} = require('../src/core/computer-target-attestation');

const target = Object.freeze({
  hwnd: 42,
  process_id: 1001,
  process_name: 'chrome',
  title: 'Physics - Google Classroom',
});
const screenSha256 = `sha256:${'a'.repeat(64)}`;

test('approval target attestation binds revision, HWND, process, app, title, and optional screen hash', () => {
  const attestation = createTargetAttestation({ revision: 3, target, screenSha256 });
  const current = assertCurrentTarget({
    attestation,
    revision: 3,
    currentTarget: target,
    currentScreenSha256: screenSha256,
  });
  assert.deepEqual(current, {
    hwnd: 42,
    process_id: 1001,
    process_name: 'chrome',
    window_title: 'Physics - Google Classroom',
  });
  assert.match(attestation.fingerprint, /^sha256:[a-f0-9]{64}$/u);
});

test('approval cannot cross task revisions', () => {
  const attestation = createTargetAttestation({ revision: 3, target });
  assert.throws(() => assertCurrentTarget({ attestation, revision: 4, currentTarget: target }), error => (
    error instanceof TargetAttestationError && error.code === 'stale_revision'
  ));
});

test('approval cannot follow an HWND reused by another app or process', () => {
  const attestation = createTargetAttestation({ revision: 3, target });
  for (const currentTarget of [
    { ...target, process_id: 2002 },
    { ...target, process_name: 'notepad' },
    { ...target, hwnd: 77 },
  ]) {
    assert.throws(() => assertCurrentTarget({ attestation, revision: 3, currentTarget }), error => (
      error instanceof TargetAttestationError && error.code === 'target_identity_changed'
    ));
  }
});

test('approval follows benign title changes but never a changed bound screen', () => {
  const attestation = createTargetAttestation({ revision: 3, target, screenSha256 });
  // A browsing window legitimately retitles as pages load; identity is
  // hwnd + process + revision, and content safety comes from the caller's
  // current-window sensitivity flag plus execution-boundary gates.
  const retitled = assertCurrentTarget({
    attestation,
    revision: 3,
    currentTarget: { ...target, title: 'SOLAT - Google Search' },
    currentScreenSha256: screenSha256,
  });
  assert.equal(retitled.window_title, 'SOLAT - Google Search');
  assert.throws(() => assertCurrentTarget({
    attestation,
    revision: 3,
    currentTarget: target,
    currentScreenSha256: `sha256:${'b'.repeat(64)}`,
  }), error => error.code === 'target_state_changed');
  assert.throws(() => assertCurrentTarget({
    attestation,
    revision: 3,
    currentTarget: target,
  }), error => error.code === 'target_state_changed');
});

test('current sensitivity always overrides a previously safe approval', () => {
  const attestation = createTargetAttestation({ revision: 3, target });
  assert.throws(() => assertCurrentTarget({
    attestation,
    revision: 3,
    currentTarget: target,
    sensitive: true,
  }), error => error instanceof TargetAttestationError && error.code === 'sensitive_target');
});

test('tampered target data invalidates the approval attestation', () => {
  const attestation = createTargetAttestation({ revision: 3, target });
  const tampered = JSON.parse(JSON.stringify(attestation));
  tampered.target.process_id = 2002;
  assert.throws(() => assertCurrentTarget({ attestation: tampered, revision: 3, currentTarget: target }), error => (
    error instanceof TargetAttestationError && error.code === 'attestation_integrity_error'
  ));
});
