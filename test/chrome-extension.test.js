const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', 'chrome-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

function extensionId(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16);
  return [...digest].map(byte => `${'abcdefghijklmnop'[byte >> 4]}${'abcdefghijklmnop'[byte & 15]}`).join('');
}

test('Chrome extension has a stable identity and a minimal MV3 boundary', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(extensionId(manifest.key), 'eokiajfkblbchdnjobacdbddjdllkeca');
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'scripting', 'storage', 'tabs'].sort());
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'");
});

test('pairing is local-only, bounded, and its URL fragment is stripped before messaging', () => {
  assert.match(background, /url\.protocol === 'ws:' && url\.hostname === '127\.0\.0\.1'/u);
  assert.match(background, /chrome\.storage\.local/u);
  assert.doesNotMatch(background, /chrome\.storage\.sync/u);
  assert.match(background, /MAX_COMMAND_CHARACTERS/u);
  assert.match(background, /MAX_SOCKET_MESSAGE_CHARACTERS/u);
  const strippedAt = popup.indexOf("history.replaceState(null, '', location.pathname)");
  const messageAt = popup.indexOf("chrome.runtime.sendMessage({ type: 'pair'");
  assert.ok(strippedAt >= 0 && strippedAt < messageAt);
});

test('private auth and payment surfaces fail closed before observation or actions', () => {
  for (const marker of ['password', 'one-time-code', 'cc-', 'captcha', 'login', 'oauth', 'checkout', 'payment', 'accounts.google.com']) {
    assert.ok(content.toLowerCase().includes(marker), `missing private marker: ${marker}`);
  }
  assert.match(content, /if \(isPrivateSurface\(\)\) return \{ privacy: 'shielded'/u);
  assert.match(content, /visiblePrivateField/u);
  assert.match(content, /visibleAuthForm/u);
  assert.match(content, /access_token\|id_token\|refresh_token/u);
  assert.match(content, /if \(isPrivateSurface\(\)\) throw Object\.assign/u);
  assert.match(background, /if \(state\.privacy === 'shielded'\) throw Object\.assign\(new Error\('Private authentication surface\.'/u);
  assert.match(background, /Chrome changed during capture; screenshot was discarded\./u);
  assert.match(background, /observed\.privacy === 'shielded' \? \{ \.\.\.shieldedTab\(tab\), items: \[\] \}/u);
  assert.match(background, /return \{ \.\.\.shieldedTab\(tab\), privacy: 'unsupported' \}/u);
  assert.match(background, /const finalStatus = await content\(sender\.tab\.id, \{ command: 'status' \}\)/u);
  assert.match(background, /if \(finalStatus\.privacy === 'shielded'\) return/u);
});

test('targets are opaque and navigation-revision scoped without destructive page mutation', () => {
  assert.match(content, /crypto\.getRandomValues\(new Uint32Array\(4\)\)/u);
  assert.match(content, /const id = opaqueTargetId\(\)/u);
  assert.match(content, /Number\(message\.revision\) !== revision/u);
  assert.doesNotMatch(content, /innerHTML\s*=/u);
  assert.doesNotMatch(content, /document\.write/u);
  assert.match(background, /document_replaced: true/u);
  assert.match(background, /command\.verify !== 'navigation'/u);
});

test('observation, transfer, screenshots, and fill payloads are bounded', () => {
  assert.match(content, /const LIMIT = 120/u);
  assert.match(content, /MAX_DOM_NODES = 10_000/u);
  assert.match(content, /MAX_CANDIDATES = 2_000/u);
  assert.match(content, /MAX_FILL_CHARACTERS = 50_000/u);
  assert.match(background, /MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/u);
  assert.match(background, /response\.body\.getReader\(\)/u);
  assert.match(background, /await reader\.cancel\(\)/u);
  assert.match(background, /MAX_SCREENSHOT_BYTES = 8 \* 1024 \* 1024/u);
  assert.match(background, /\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif', 'image\/avif'\]/u);
});

test('extension has no remote service endpoint, dynamic code, cookie, or browsing-history access', () => {
  const source = [background, content, popup].join('\n');
  assert.doesNotMatch(source, /https?:\/\//iu);
  assert.doesNotMatch(source, /\beval\s*\(/u);
  assert.doesNotMatch(source, /new Function\s*\(/u);
  assert.doesNotMatch(source, /chrome\.cookies/u);
  assert.doesNotMatch(source, /chrome\.history/u);
});

test('V3 full control lists every normal-window tab and checks privacy before switching', () => {
  assert.match(background, /chrome\.windows\.getAll\(\{ windowTypes: \['normal'\], populate: true \}\)/u);
  assert.match(background, /const tabs = await chrome\.tabs\.query\(\{\}\)/u);
  assert.match(background, /MAX_TAB_PAGE = 100/u);
  assert.match(background, /next_offset/u);
  const checkedAt = background.indexOf('const checked = await safeTab(await chrome.tabs.get(tabId))');
  const activateAt = background.indexOf("chrome.tabs.update(tabId, { active: true })");
  assert.ok(checkedAt >= 0 && activateAt > checkedAt, 'switch_tab must inspect privacy before activation');
  assert.match(background, /if \(checked\.privacy !== 'clear'\) throw Object\.assign/u);
  assert.match(background, /active: Boolean\(tab\.active\)/u);
});

test('authenticated public tabs receive the renderer-matched SOLAT cursor and indicator', () => {
  assert.match(background, /message\.type === 'ready'\) \{ authenticated = true; void syncIndicators\(\); return; \}/u);
  assert.match(background, /void disableIndicators\(\)/u);
  assert.match(background, /command: 'control_indicator'/u);
  assert.match(content, /host\.attachShadow\?\.\(\{ mode: 'open' \}\)/u);
  assert.match(content, /cursor\.id = 'solatCursor'/u);
  assert.match(content, /indicator\.id = 'solatControlIndicator'/u);
  assert.match(content, /clip-path: polygon\(0 0, 92% 64%/u);
  assert.match(content, /drop-shadow\(4px 5px 0 rgba\(255,33,24,.9\)\)/u);
  assert.match(content, /pointermove/u);
  assert.match(content, /pointerdown/u);
  assert.match(content, /cursor\.classList\.add\('hit'\)/u);
});

test('indicator is removed on disconnect and privacy transitions, including auth/payment/CAPTCHA mutation', () => {
  assert.match(background, /authenticated = false;\s+void disableIndicators\(\)/u);
  assert.match(background, /message\?\.type === 'solat_privacy_state'/u);
  assert.match(background, /message\.privacy === 'shielded' \|\| message\.privacy === 'unsupported'/u);
  assert.match(content, /if \(!enabled \|\| isPrivateSurface\(\)\)/u);
  assert.match(content, /new MutationObserver\(queuePrivacyCheck\)/u);
  assert.match(content, /reportPrivacyState\('shielded'\)/u);
  for (const marker of ['payment', 'captcha', 'one-time-code', 'accounts.google.com']) assert.match(content.toLowerCase(), new RegExp(marker, 'u'));
});
