const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const voiceController = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'voice-controller.js'), 'utf8');
const spatialOverlayHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'spatial-overlay.html'), 'utf8');
const spatialOverlay = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'spatial-overlay.js'), 'utf8');
const spatialPreload = fs.readFileSync(path.join(__dirname, '..', 'src', 'spatial-preload.js'), 'utf8');
const browserHtml = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-workspace.html'), 'utf8');
const browserRenderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'browser-workspace.js'), 'utf8');
const browserPreload = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-workspace-preload.js'), 'utf8');
const browserManager = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-workspace-manager.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const ipcRouter = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc-router.js'), 'utf8');
const services = fs.readFileSync(path.join(__dirname, '..', 'src', 'services.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const v1Candidates = [
  path.join(__dirname, '..', '..', 'frontend', 'claude', 'SolatUI.html'),
  path.join(__dirname, 'fixtures', 'SolatUI.html'),
];
const v1Path = v1Candidates.find(candidate => fs.existsSync(candidate));
assert.ok(v1Path, 'V1 UI reference fixture is required for the compatibility test');
const v1 = fs.readFileSync(v1Path, 'utf8');

test('renderer preserves the owner visual shell while exposing the V2 IPC surface', () => {
  for (const id of [
    'topbar',
    'boot',
    'sidebar',
    'chat',
    'status',
    'statusText',
    'chatTitle',
    'modelName',
    'log',
    'stream',
    'composerWrap',
    'composer',
    'input',
    'sendBtn',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /class=["'][^"']*fly[^"']*["']/i, 'owner butterfly shell missing');
  assert.match(html, /\.welcome\s*\{/i, 'owner welcome style missing');
  assert.match(html, /\.starters\s*\{/i, 'owner starter style missing');
  assert.match(html, /<script\s+src=["']\.\/renderer\.js(?:\?[^"']*)?["']/);
  assert.doesNotMatch(html, /<script\s*>/i, 'inline V1 application logic must not enter V2');
  assert.doesNotMatch(html, /(?:127\.0\.0\.1|localhost):\d+/i, 'renderer must not depend on a manual port');
  assert.match(html, /class=["'][^"']*ui-mode-toggle[^"']*["']/i, 'UI mode toggle is missing');
  assert.match(html, /ui-mode-art-blue"\s+src="\.\/assets\/reblog-jakku-san-22-images-1\.jfif/i, 'blue UI mode art must use the blue source image');
  assert.match(html, /ui-mode-art-red"\s+src="\.\/assets\/download-6\.jfif/i, 'red UI mode art must not replace the initial blue image');
  assert.match(html, /solat-voice-transition-runtime-1080p60\.mp4/i, 'SOLAT transition must use the smooth runtime asset');
  assert.match(html, /id="solatVoiceLoop"[^>]*\bloop\b[^>]*solat-voice-final-loop-1080p60\.mp4/i, 'final animation must use its dedicated native loop asset');
  assert.match(html, /#solatVoiceScene\.video-ready #solatVoiceVideo\s*\{\s*opacity:\s*1/i, 'transition video must wait for a decoded playing frame');
  assert.match(renderer, /video\.onplaying\s*=\s*\(\)\s*=>\s*scene\.classList\.add\('video-ready'\)/, 'transition must reveal only after playback starts');
  assert.match(renderer, /video\.onended\s*=\s*startFinalLoop/, 'completed transition must enter the final animation loop');
  assert.match(renderer, /loopVideo\.loop\s*=\s*true/, 'final animation loop must remain active indefinitely');
  assert.match(html, /\.solat-voice-viewport\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/i, 'voice stage must use a true responsive 16:9 viewport');
  assert.match(html, /id="solatVoiceViewport"[\s\S]*?id="solatVoiceVideo"[\s\S]*?id="solatVoiceLoop"/i, 'both videos must render inside the adaptive stage');
  assert.match(html, /object-fit:\s*fill;\s*object-position:\s*center center/i, 'same-ratio runtime video must fill the 16:9 stage without letterboxing or cropping');
  assert.doesNotMatch(html, /#solatVoiceVideo[^}]*background:\s*#050505/i, 'transition video must not add black letterbox bars');
  assert.match(html, /solat-voice-stage-backdrop\.jpg/i, 'full-bleed stage backdrop must replace visible top and bottom bars without cropping the main video');
  assert.doesNotMatch(html, /id="solatVoiceOrb"|solat-voice-orb-shell/i, 'the optional CD must not be forced into the active voice stage');
  assert.doesNotMatch(html, /solat-voice-core-cd-v2\.png/i, 'the rejected CD must not remain in the active voice stage');
  assert.match(html, /class="solat-persona-voice-frame"[^>]*solat-persona-voice-frame-v3\.png/i, 'voice stage must use the refined large Persona system frame overlay');
  assert.match(html, /class="solat-voice-memento"[\s\S]*?solat-memento-mori-decor-v3\.png/i, 'voice stage must restore the Memento Mori top-right decoration');
  assert.doesNotMatch(html, /class="solat-persona-orb"|solat-persona-voice-character-v1\.png/i, 'voice stage must remove the rejected orb artwork');
  assert.match(html, /class="solat-voice-signal-anchor"[\s\S]*?solat-voice-status-thinking/i, 'voice effects must originate from the headset signal anchor');
  assert.match(html, /\.solat-persona-voice-frame\s*\{[\s\S]*?z-index:\s*8[\s\S]*?inset:\s*-10px[\s\S]*?pointer-events:\s*none/i, 'Persona frame must sit on the outermost edge without blocking controls');
  assert.match(html, /\.solat-voice-exit\s*\{[\s\S]*?z-index:\s*9/i, 'red return control must stay above the outer Persona frame');
  assert.match(html, /id="solatVoicePreview"[\s\S]*?solat-voice-preview-text/i, 'voice mode must expose a readable speech preview');
  assert.match(html, /AI–HUMAN WORKSPACE[\s\S]*?Voice link ready\. Speak naturally to SOLAT\./i, 'voice mode must restore the 7:15 PM ready instruction');
  assert.match(html, /\.solat-voice-preview\s*\{[\s\S]*?left:\s*58%[\s\S]*?width:\s*min\(38%[\s\S]*?max-height:\s*min\(24vh,\s*190px\)/i, 'voice preview must use the 7:15 PM compact placement');
  assert.match(html, /\.solat-voice-preview-text\s*\{[\s\S]*?max-height:\s*none[\s\S]*?overflow:\s*visible/i, 'voice preview must use the 7:15 PM text treatment');
  assert.match(html, /AI–HUMAN WORKSPACE[\s\S]*?Voice link ready\. Speak naturally to SOLAT\./i, 'voice preview must restore the 7:15 PM ready copy');
  assert.doesNotMatch(html, /solat-voice-preview[\s\S]*?var\(--font-ui\)/i, 'voice preview must use a defined font token');
  assert.match(html, /\.msg\.user \.bubble\s*\{\s*min-width:\s*88px/i, 'short user messages must not collapse into one-character columns');
  assert.match(html, /\.solat-voice-preview\s*\{[\s\S]*?background:\s*rgba\(2,14,48,\.78\)[\s\S]*?border-left:\s*2px solid #55edff/i, 'voice preview must restore the Persona 3 compact box');
  assert.match(renderer, /setSolatVoicePreview\(result\.assistant\)/i, 'assistant speech must populate the readable voice preview');
  assert.doesNotMatch(html, /solatAthenaState|solat-athena-state[^}]*listening/i, 'voice orb must not display a listening label');
  assert.match(html, /id="solatVoiceStateLabel"[^>]*>VOICE \/ READY/i, 'voice stage must expose its active state');
  assert.match(html, /id="solatVoiceMicButton"[^>]*class="solat-voice-memento"[\s\S]*?solat-memento-mori-decor-v3\.png/i, 'Blue voice stage must use the Memento artwork as its microphone control');
  assert.match(html, /@font-face[\s\S]*?Persona5Menu[\s\S]*?Persona5MenuFontPrototype-Regular\.ttf/i, 'the original Persona font must remain bundled locally');
  assert.match(html, /@font-face[\s\S]*?P5Hatty[\s\S]*?p5hatty-1\.ttf/i, 'the replacement non-Persona font must be bundled locally');
  assert.match(html, /\.msg \.bubble,\s*\.msg \.bubble \*\s*\{[\s\S]*?font-family:\s*'Inter',\s*'Leelawadee UI',\s*Tahoma,\s*sans-serif\s*!important/i, 'all rendered chat copy must use the readable non-Persona font');
  assert.match(html, /:root:not\(\.home-mode\) #input\s*\{\s*font-family:\s*'Inter',\s*'Leelawadee UI',\s*Tahoma,\s*sans-serif\s*!important/i, 'the in-chat composer must use the readable non-Persona font');
  assert.match(html, /\.who-line, #chatTitle\s*\{\s*font-family:\s*var\(--f-persona\)/i, 'chat chrome must keep the Persona font');
  assert.match(html, /--f-display:\s*var\(--f-persona\)[\s\S]*?--f-ui:\s*var\(--f-persona\)[\s\S]*?--f-mono:\s*var\(--f-persona\)/i, 'Red and Blue UI font tokens must use the Persona font');
  assert.match(html, /button\.solat-voice-memento\s*\{[\s\S]*?pointer-events:\s*auto/i, 'Memento microphone control must remain clickable above the voice scene');
  assert.match(html, /id="solatVoiceExitButton"[\s\S]*?download-6\.jfif/i, 'voice mode return control must use the red owner-selected art');
  assert.match(html, /\.solat-voice-exit\s*\{[\s\S]*?top:\s*14px[\s\S]*?width:\s*52px;\s*height:\s*40px/i, 'red return control must occupy the same top-right footprint as the blue UI toggle');
  assert.match(renderer, /#solatVoiceExitButton'\)\?\.addEventListener\('click',\s*exitSolatVoiceMode\)/, 'red voice control must return to the classic red interface');
  assert.match(renderer, /function\s+exitSolatVoiceMode\([\s\S]*?classList\.remove\('solat-voice-active'\)[\s\S]*?setUiMode\('classic',\s*false\)/, 'voice exit must stop playback and restore the red UI');
  assert.match(html, /solat-voice-status-thinking\.png/i, 'voice mode must show the owner-selected HOLD UP graphic while AI is thinking');
  assert.match(html, /solat-voice-status-answer\.png/i, 'voice mode must keep the original answer decoration asset');
  assert.match(renderer, /if \(on\) Voice\?\.markThinking\(\)/, 'busy provider work must drive the voice thinking state');
  assert.match(renderer, /Voice\?\.active[\s\S]*?Voice\.speak\(text\(result\.assistant\)/, 'only the visible assistant answer must be sent to speech playback');
  assert.match(renderer, /function\s+voiceLanguageFor[\s\S]*?\\u0E00-\\u0E7F[\s\S]*?return 'th'/, 'Thai assistant text must request Thai synthesis instead of inheriting an unrelated OS locale');
  assert.match(renderer, /onFinalTranscript:[\s\S]*?if \(busy\) await waitForChatIdle\(\);[\s\S]*?return true;/, 'busy chat must queue the final transcript until the existing turn is idle instead of discarding it');
  assert.match(renderer, /const SOLAT_VOICE_READY = 'SOLAT READY/i, 'voice UI must define a ready message');
  assert.match(renderer, /toggleVoiceInput[\s\S]*?setSolatVoicePreview\(starting \? SOLAT_VOICE_READY/i, 'pressing Memento must announce SOLAT READY');
  assert.doesNotMatch(renderer, /enterSolatVoiceMode[\s\S]*?Voice\?\.enter\(/, 'opening Blue mode must wait for the Memento interaction before starting voice');
  assert.match(renderer, /addEventListener\('solat:voice-activity'[\s\S]*?setSolatVoiceActivity\(detail\.state/, 'future speech playback must be able to keep the voice answer state synchronized');
  assert.match(html, /data-voice-activity="thinking"[\s\S]*?solat-voice-status-thinking/i, 'thinking art must be selected by the explicit voice activity state');
  assert.match(html, /data-voice-activity="answer"[\s\S]*?solat-voice-status-answer/i, 'answer art must be selected by the explicit voice activity state');
  assert.match(html, /#solatCursor\s*\{[\s\S]*?z-index:\s*13000/i, 'special SOLAT cursor must render above the transition video');
  assert.match(html, /\.ink-hit\s*\{[\s\S]*?z-index:\s*12950/i, 'click effect must render above voice mode and below the special cursor');
  assert.match(html, /:root\.solat-voice-active body > :not\(#solatVoiceScene\):not\(#solatExitCover\):not\(#solatCursor\):not\(\.ink-hit\)/i, 'voice mode must keep the click effect visible while allowing the exit cover');
  assert.match(html, /#solatVoiceScene\.exiting\s*\{[\s\S]*?visibility:\s*hidden[\s\S]*?opacity:\s*0/i, 'voice exit must hide the blue scene before restoring the red interface');
  assert.match(html, /id="solatExitCover"/i, 'voice exit must use an opaque red handoff cover to prevent a leaked blue frame');
  assert.match(renderer, /exitCover\?\.classList\.add\('active',\s*'returning'\)[\s\S]*?exitCover\?\.classList\.remove\('active',\s*'returning'\)/i, 'voice exit must hold the animated red cover across the handoff');
  assert.match(html, /solat-return-mark[\s\S]*?solat-joker-red-transition\.jpg/i, 'voice exit must show the Joker red return artwork during the handoff');
  assert.match(html, /#solatExitCover\.returning::before[\s\S]*?solatReturnCurtain\s+1\.82s/i, 'voice exit must use a visible, paced red curtain transition');
  assert.match(renderer, /scene\.classList\.add\('exiting'\)[\s\S]*?setTimeout\(\(\) => {[\s\S]*?1900/i, 'voice exit must keep the red transition visible long enough to read');
  assert.doesNotMatch(html, /data-motion="off"\]\s+#solatCursor/i, 'motion preference must not remove the special cursor');
  assert.match(html, /:root\.solat-voice-active body > :not\(#solatVoiceScene\):not\(#solatExitCover\):not\(#solatCursor\)/i, 'background UI must stop painting while the transition is active');
  assert.match(renderer, /document\.documentElement\.classList\.add\('solat-voice-active'\)/, 'transition must suspend the background UI before playback');
  assert.match(main, /backgroundThrottling:\s*false/, 'Electron must not throttle active transition frames');
  assert.deepEqual(packageJson.build.asarUnpack, [
    'renderer/assets/solat-voice-transition-runtime-1080p60.mp4',
    'renderer/assets/solat-voice-final-loop-1080p60.mp4',
    'renderer/assets/hand_landmarker.task',
    'node_modules/@mediapipe/tasks-vision/wasm/**/*',
  ], 'runtime videos and local hand-inference binaries must be unpacked for direct loading');
  assert.ok(packageJson.build.files.includes('!renderer/assets/solat-voice-transition-master-4k60.mp4'), '4K master must stay outside the packaged runtime');
  assert.ok(packageJson.build.files.includes('!renderer/assets/solat-voice-transition-master-ai-4k30.mp4'), 'AI 4K master must stay outside the packaged runtime');
  assert.ok(packageJson.build.files.includes('THIRD_PARTY_NOTICES.md'), 'packaged third-party attribution is required');
  assert.ok(packageJson.build.files.includes('LICENSES/Apache-2.0.txt'), 'the Apache-2.0 redistribution license must be packaged');
  assert.ok(packageJson.build.files.includes('docs/USER_TUTORIAL_V3_V6.md'), 'the owner V3-V6 tutorial must be packaged');
  assert.match(renderer, /classList\.contains\('ui-mode-toggle'\)/, 'settings must not replace UI mode art');
  assert.match(renderer, /localStorage\.setItem\('solat\.ui\.mode'/, 'UI mode must persist locally');
  assert.doesNotMatch(html, /\bfetch\s*\(/i, 'provider calls belong behind Electron IPC');
  assert.match(html, /\.msg:focus,\s*\.msg:focus-visible\s*\{\s*outline:\s*none;\s*\}/, 'programmatic message focus must not draw a blue frame');
  assert.match(renderer, /sessionId\s*=\s*createSessionId\(\)/, 'new conversation must isolate its session');
  assert.match(renderer, /window\.solat\.setModelMode/, 'model selector must cross secure IPC');
  assert.match(renderer, /chooseModelMode/, 'model selector menu is missing');
  assert.match(preload, /setModelMode:\s*async mode/, 'preload must expose bounded model selection');
});

test('new conversations open directly in the interior workspace', () => {
  assert.match(renderer, /classList\.remove\('home-mode'\)/, 'legacy home mode must always be disabled');
  assert.match(renderer, /classList\.toggle\('empty-mode',\s*emptyMode\)/, 'empty workspace state must remain explicit');
  assert.match(renderer, /class:\s*'inner-empty'/, 'interior empty workspace missing');
  assert.match(renderer, /'What are we '/i, 'interior workspace heading missing');
  assert.match(renderer, /text:\s*'building\?'/i, 'interior workspace heading emphasis missing');
  assert.match(renderer, /class:\s*'inner-starter'/, 'interior starter actions missing');
  assert.match(renderer, /\['check',\s*'Plan'/);
  assert.match(renderer, /\['search',\s*'Research'/);
  assert.match(renderer, /\['spark',\s*'Create'/);
  assert.doesNotMatch(renderer, /class:\s*'pixel-collage'/, 'legacy pixel collage must not render');
  assert.doesNotMatch(renderer, /class:\s*'master-nav'/, 'legacy home navigation must not render');
  assert.match(html, /SOLAT INNER WORKSPACE/, 'interior visual system missing');
  assert.match(html, /\.inner-empty\s*\{/i, 'interior empty-state layout missing');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', 'assets', 'ren-amamiya-joker.jfif')), 'empty workspace art asset missing');
  assert.match(renderer, /class:\s*'inner-art'/, 'empty workspace art layer missing');
  assert.match(renderer, /ren-amamiya-joker\.jfif/, 'empty workspace art source missing');
  assert.doesNotMatch(renderer, /persona-project-roses(?:-transparent)?\.png/, 'flower cover art must not render');
  assert.match(renderer, /persona-plan-target\.jfif/, 'plan art source missing');
  assert.match(renderer, /persona-research-card\.jfif/, 'research card art source missing');
  assert.match(renderer, /persona-research-star-transparent\.png/, 'create transparent star art source missing');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', 'assets', 'persona-research-star-transparent.png')), 'transparent create art asset missing');
  assert.doesNotMatch(html, /\.inner-starter-create::after[\s\S]*persona-research-star/i, 'duplicate create star decoration must not return');
  assert.match(html, /:root:not\(\.home-mode\) #log[\s\S]*overflow-y:\s*auto/i, 'interior workspace must remain vertically scrollable');
  assert.match(html, /\.inner-starter\s*\{[\s\S]*background:\s*rgba\(255,245,223,\.035\)[\s\S]*opacity:\s*1/i, 'starter cards must share the reference opacity');
  assert.match(html, /\.inner-art\s*\{[\s\S]*?mask-image:/i, 'empty workspace art must fade into the right-side background');
  assert.match(html, /#homeCharacter\s*\{\s*display:\s*none\s*!important;/i, 'legacy character must remain hidden');
  assert.match(html, /prefers-reduced-motion:\s*reduce/i, 'reduced motion support missing');
  assert.match(renderer, /desktop_bridge_unavailable/, 'browser preview must fail truthfully');
  assert.match(renderer, /function visibleMessageText\(message\)/, 'stored preview failures must remain user-readable');
  assert.match(renderer, /Cannot read properties of undefined/, 'legacy preview failures must be normalized');
  assert.match(html, /id=["']brandHomeBtn["']/i, 'SOLAT brand must be a workspace return control');
  assert.match(renderer, /brandHomeBtn.*newConversation/, 'SOLAT brand must return to the empty workspace');
  assert.match(html, /@keyframes\s+innerScan/i, 'workspace needs continuous ambient motion');
  assert.match(html, /@keyframes\s+innerCardIdle/i, 'starter cards need subtle idle motion');
  for (const asset of ['persona-chat-bubble.jfif']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', 'assets', asset)), `${asset} asset missing`);
    assert.match(html, new RegExp(asset.replace('.', '\\.'), 'i'), `${asset} is not assigned to the interior UI`);
  }
  assert.match(html, /\.inner-empty::after\s*\{\s*display:\s*none\s*!important;/i, 'faint empty-state decoration must stay removed');
  assert.match(html, /\.inner-empty-signal::after\s*\{\s*display:\s*none\s*!important;/i, 'faint signal decoration must stay removed');
  assert.match(html, /@keyframes\s+uiModeBlueIdle/i, 'blue UI mode needs idle motion');
  assert.match(html, /@keyframes\s+uiModeRedIdle/i, 'red UI mode needs idle motion');
  assert.match(html, /#sendTransition::before[\s\S]*var\(--solat-red\)/i, 'classic send transition layer missing');
  assert.match(html, /#newChatTransition::before[\s\S]*var\(--solat-paper\)/i, 'classic new-chat transition layer missing');
  assert.match(html, /persona-menu-icon\.jfif/i, 'mobile menu art missing');
  assert.match(html, /persona-pinterest-icon\.jfif/i, 'projects art missing');
  assert.match(html, /persona-files-icon\.jfif/i, 'files art missing');
  assert.match(html, /persona-settings-icon\.jfif/i, 'settings art missing');
  assert.doesNotMatch(html, /\.inner-front-art\s*\{/i, 'flower cover art styles must be removed');
  assert.doesNotMatch(html, /persona-star-trail\.jfif/i, 'star trail must not clutter the cover workspace');
  assert.match(renderer, /function playSendTransition\(\)[\s\S]*?Settings\.get\('motion'\)/i, 'send transition must be available in the interior workspace');
  assert.match(html, /--inner-muted:/i, 'interior text needs an explicit contrast token');
  assert.doesNotMatch(renderer, /label:\s*'Replay the opening'/, 'retired opening command must not remain');
});

test('projects and files use real local data instead of decorative sample rows', () => {
  assert.match(html, /id=["']newProjectBtn["']/i, 'create-project action missing');
  assert.match(html, /id=["']projectList["']/i, 'project data host missing');
  assert.match(html, /id=["']addFilesBtn["']/i, 'add-files action missing');
  assert.match(html, /id=["']fileLibraryList["']/i, 'file library data host missing');
  assert.match(html, /id=["']libraryFileInput["'][^>]*multiple/i, 'persistent file picker missing');
  assert.match(renderer, /const Projects\s*=\s*\{/i, 'project store missing');
  assert.match(renderer, /solat\.v2\.projects/i, 'project persistence key missing');
  assert.match(renderer, /const LibraryFiles\s*=\s*\{/i, 'file library missing');
  assert.match(renderer, /indexedDB\.open\('solat-v2-library',\s*1\)/i, 'file library must use durable browser storage');
  assert.match(renderer, /new File\(\[record\.blob\],\s*record\.name/i, 'saved file must be attachable again');
  assert.match(renderer, /tx\.oncomplete\s*=\s*\(\)\s*=>\s*resolve\(result\)/, 'file reads must wait for their transaction');
  assert.match(renderer, /saved file could not be read back/i, 'file imports must verify durable storage before success');
  assert.doesNotMatch(html, /Image Recognition API|NLP Pipeline v2|Recommendation Engine|model_config\.json|training_pipeline\.py/i, 'decorative project/file samples must be removed');
});

test('chat composer exposes a compact truthful command state', () => {
  assert.match(html, /class=["']composer-head["']/i, 'composer command header missing');
  assert.match(html, /class=["']composer-ident["']>SOLAT INPUT</i, 'composer identity missing');
  assert.match(html, /class=["']composer-mode["']>COMMAND READY</i, 'composer ready state missing');
  assert.match(html, /class=["']send-label["']>Send</i, 'send action must have a visible label');
  assert.match(html, /placeholder=["']Message SOLAT\.\.\.["']/i, 'composer placeholder must remain compact');
  assert.match(renderer, /syncMode\(forced = ''\)/, 'composer mode must track interaction state');
  assert.match(renderer, /MESSAGE ARMED/, 'composer must expose the ready-to-send state');
  assert.match(renderer, /SOLAT RESPONDING/, 'composer must expose the responding state');
});

test('V2 spatial input uses the secure overlay and the normal chat path', () => {
  assert.match(html, /id=["']spatialBtn["'][^>]*aria-label=["']Point or draw on screen/i, 'spatial input control missing');
  assert.match(renderer, /window\.solat\.spatialOpen\(\{[\s\S]*?sessionId:\s*sessionFor\(State\.activeId\)/, 'spatial input must use the active conversation session');
  assert.match(renderer, /onSpatialEvent[\s\S]*?Say “อันนี้” or “ตรงนี้”/, 'captured context must return to the normal composer');
  assert.match(preload, /spatialOpen:[\s\S]*?ipcRenderer\.invoke\('solat:spatial-open'/, 'main renderer must use narrow spatial IPC');
  assert.match(spatialPreload, /contextBridge\.exposeInMainWorld\('solatSpatial'/, 'overlay must use an isolated preload bridge');
  assert.doesNotMatch(spatialOverlayHtml, /<script(?![^>]*src=)/i, 'spatial overlay must not use inline scripts');
  for (const gesture of ['circle', 'x', 'arrow', 'highlight', 'freehand', 'lasso', 'click', 'drag']) {
    assert.match(spatialOverlayHtml, new RegExp(`data-gesture=["']${gesture}["']`), `spatial overlay is missing ${gesture}`);
  }
  assert.match(spatialOverlay, /points\.length\s*>=\s*2048/, 'overlay must cap captured pointer points');
  assert.match(spatialOverlay, /devicePixelRatio/, 'overlay must scale its canvas for display DPI');
  assert.match(spatialOverlay, /pointercancel[\s\S]*?lostpointercapture/, 'cancelled pointers must not leave the overlay drawing state stuck');
  assert.match(spatialOverlay, /pointerType === 'pen' \? 'stylus'[\s\S]*?'touch'/, 'pointer source must preserve mouse, touch, and stylus input');
  assert.match(ipcRouter, /spatialMemory\?\.contextFor[\s\S]*?core\.send\(\{ \.\.\.request,[\s\S]*?spatialContext/, 'spatial context must enter the existing Chat core request');
  assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+Space'/, 'spatial overlay needs a global shortcut for pointing outside SOLAT');
  assert.doesNotMatch(spatialOverlay, /\bfetch\s*\(/i, 'overlay must never call a provider directly');
});

test('V3 exposes a dynamic isolated Browser Workspace without redesigning the chat shell', () => {
  assert.match(html, /id=["']browserBtn["'][^>]*aria-label=["']Open Browser Workspace/i, 'browser workspace control missing');
  assert.match(renderer, /window\.solat\.browserOpen\([\s\S]*?sessionId:\s*sessionFor\(State\.activeId\)/, 'browser workspace must use the active conversation session');
  assert.match(renderer, /window\.solat\.browserOpen\(\{[\s\S]*?mode:\s*'focused'/, 'renderer must use a mode accepted by the Browser Workspace contract');
  assert.doesNotMatch(renderer, /window\.solat\.browserOpen\(\{[\s\S]*?mode:\s*'window'/, 'renderer must not send the removed window mode');
  assert.match(preload, /browserOpen:[\s\S]*?solat:browser-open/, 'main renderer must use narrow browser IPC');
  assert.match(browserPreload, /contextBridge\.exposeInMainWorld\('solatBrowserShell'/, 'browser toolbar must use an isolated preload bridge');
  assert.match(browserManager, /new this\.WebContentsView[\s\S]*?contextIsolation:\s*true[\s\S]*?nodeIntegration:\s*false[\s\S]*?sandbox:\s*true/, 'remote website must be isolated from Node and SOLAT IPC');
  assert.match(browserManager, /persist:solat-browser-v3-/, 'ordinary login cookies must use a stable local profile');
  assert.match(browserManager, /const popupHandler[\s\S]*?active\.mode !== 'user'[\s\S]*?action: 'allow'/, 'only direct user control may open a sandboxed popup');
  assert.match(browserManager, /sensitiveSurfaceScript[\s\S]*?browser_sensitive_surface/, 'password and one-time-code pages must close SOLAT observation and capture paths');
  assert.match(browserManager, /authRoute[\s\S]*?login[\s\S]*?oauth[\s\S]*?challenge/, 'the whole authentication route must become private before credential or QR interaction');
  assert.doesNotMatch(browserManager, /setUserAgent\(/, 'SOLAT must not disguise Electron to bypass Google embedded-user-agent policy');
  assert.match(browserManager, /setPermissionRequestHandler[\s\S]*?callback\(false\)/, 'remote permissions must be denied by default');
  assert.match(browserHtml, /Search Google or enter address[\s\S]*?id="openChrome"[\s\S]*?PRIVATE INPUT · SOLAT BLIND/i, 'the browser frame must expose omnibox, Chrome handoff and privacy state');
  assert.match(browserHtml, /Content-Security-Policy/i, 'local browser toolbar needs a CSP');
  assert.doesNotMatch(browserHtml, /<script(?![^>]*src=)/i, 'browser toolbar must not use inline scripts');
  assert.doesNotMatch(browserRenderer, /\bfetch\s*\(/i, 'browser toolbar must never call a provider or remote page directly');
});

test('V3-V6 tutorial is discoverable and teaches only wired interaction paths', () => {
  assert.match(html, /id=["']tutorialV3V6["'][\s\S]*?V3 · Browser Workspace[\s\S]*?V4 · SpatialAsset[\s\S]*?V5 · Hand Tracking[\s\S]*?V6 · Fusion, memory, and Undo/);
  assert.match(renderer, /label:\s*'V3–V6 tutorial'[\s\S]*?setTimeout\(\(\) => Overlay\.open\(\$\('#tutorialV3V6'\)\), 0\)/, 'tutorial opening must wait until the palette pointer gesture is complete');
  assert.match(html, /Alt[\s\S]*?Use image[\s\S]*?IMAGE HELD[\s\S]*?Esc/);
  assert.match(html, /Undo last interaction reference/);
  assert.match(html, /V6 interaction memory[^<]*ไม่เก็บ[^<]*raw camera frame/i);
});

test('V4 SpatialAsset uses narrow IPC and a derived pointer ghost instead of native drag-and-drop', () => {
  assert.match(html, /id=["']spatialAssetGhost["']/i, 'derived ghost layer missing');
  assert.match(html, /id=["']spatialAssetStatus["'][^>]*role=["']status["']/i, 'cross-surface state must be visible');
  for (const operation of ['Register', 'Select', 'Begin', 'Move', 'Switch', 'Drop', 'Cancel', 'Memory']) {
    assert.match(preload, new RegExp(`spatialAsset${operation}:[\\s\\S]*?solat:spatial-asset-${operation.toLowerCase()}`), `narrow SpatialAsset ${operation} bridge missing`);
  }
  assert.match(renderer, /const SpatialAssets\s*=\s*\{[\s\S]*?queueMove\([\s\S]*?pointermove[\s\S]*?pointerup/, 'pointer protocol controller missing');
  assert.match(renderer, /window\.solat\.spatialAssetSwitch\([\s\S]*?targetSurface/, 'surface switching must cross main-process validation');
  assert.match(renderer, /Holding image · \$\{target\}/, 'held cross-surface state missing');
  assert.match(renderer, /รูปที่เพิ่งแปะ/, 'latest Thai insertion reference hint missing');
  assert.match(renderer, /preview\.addEventListener\('pointerdown'[\s\S]*?SpatialAssets\.beginFromAttachment/, 'image attachments must enter the pointer protocol');
  assert.match(html, /id="handBtn"[\s\S]*?Toggle hand tracking/, 'hand tracking control missing');
  assert.match(html, /connect-src 'self'/, 'hand WASM may load only from the packaged local origin');
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/, 'hand inference may compile WASM without enabling general JavaScript unsafe-eval');
  assert.doesNotMatch(html, /script-src[^;]*\s'unsafe-eval'/, 'general JavaScript unsafe-eval must remain disabled');
  assert.match(renderer, /const HandInput\s*=\s*\{[\s\S]*?import\('\.\/hand-tracking-runtime\.mjs'\)[\s\S]*?onHandEvent[\s\S]*?consumeHandEvent/, 'hand runtime must feed the shared SpatialAsset protocol');
  assert.match(renderer, /event\?\.points\?\.\[0\][\s\S]*?pointerType:\s*'hand'/, 'semantic hand coordinates must use the hand input source');
  assert.match(renderer, /ensureStoredAttachment\(item, this\.sessionId\(\)\)[\s\S]*?spatialCapability/, 'SpatialAsset registration must reuse the authoritative upload capability');
  assert.doesNotMatch(renderer, /SpatialAssets[\s\S]{0,3000}dataTransfer/, 'SpatialAsset runtime must not rely on native DataTransfer');
  assert.match(preload, /onBrowserAssetSelected:[\s\S]*?solat:browser-asset-selected/, 'browser-selected assets need an owner-bound event bridge');
  assert.match(preload, /chromeAssetImport:[\s\S]*?solat:chrome-asset-import/, 'Chrome image bytes need a narrow owner-bound import bridge');
  assert.match(preload, /chromeControlStatus:[\s\S]*?solat:chrome-control-status[\s\S]*?chromeControlPair:[\s\S]*?solat:chrome-control-pair/, 'Chrome Control setup must use narrow preload methods');
  assert.match(preload, /chromeControlTabs:[\s\S]*?solat:chrome-control-tabs[\s\S]*?chromeControlSwitchTab:[\s\S]*?solat:chrome-control-switch-tab/, 'Full Chrome tab discovery and switching must use narrow IPC methods');
  assert.match(renderer, /label:\s*'Chrome Control setup'[\s\S]*?ChromeControlSetup\.open/, 'Chrome Control setup must be reachable from the command palette');
  assert.match(html, /id="chromeControlSetup"[\s\S]*?Human-private boundary:[\s\S]*?password, OTP, payment, CAPTCHA[\s\S]*?id="chromeControlPair"[\s\S]*?id="chromeControlAdopt"/, 'Chrome Control setup must explain and preserve private authentication boundaries');
  assert.match(html, /Full Chrome Control:[\s\S]*?id="chromeControlTabs"/, 'Full Chrome Control must show its normal-tab scope and visible tab list');
  assert.match(renderer, /chromeControlTabs\(\{ sessionId:\s*sessionFor\(State\.activeId\) \}\)/, 'Full Chrome tab discovery must stay conversation-scoped');
  assert.match(renderer, /chromeControlSwitchTab\(\{ sessionId:\s*sessionFor\(State\.activeId\), tabRef: tab\.tab_ref \}\)/, 'Full Chrome switching must use one opaque conversation-scoped tab ref');
  assert.doesNotMatch(html, /(?:data-(?:token|secret)|value=["'][^"']*(?:token|secret))/i, 'Chrome Control pairing material must never be rendered in the setup UI');
  assert.match(renderer, /document\.addEventListener\('paste'[\s\S]*?importChromeImage[\s\S]*?chromeAssetImport/, 'copied Chrome images must enter the existing SpatialAsset protocol without reading Chrome cookies');
  assert.match(renderer, /adoptBrowserSelection\([\s\S]*?preview_bytes[\s\S]*?this\.held\s*=\s*payload\.ghost/, 'browser selection must enter the same held-ghost protocol');
  assert.match(renderer, /event\?\.type === 'closed'[\s\S]*?SpatialAssets\.useBlueSurface/, 'closing Browser Workspace must transfer the held asset back to Blue');
  assert.match(browserHtml, /id="selectAsset"[\s\S]*?Use image/, 'Browser Workspace must expose the image selection action');
  assert.match(html, /id="spatialInsertionLayer"/, 'Blue Workspace must expose a concrete insertion surface');
  assert.match(renderer, /targetSurface\.kind === 'blue_workspace'[\s\S]*?spatial-insertion-preview|targetSurface\.kind === 'blue_workspace'[\s\S]*?renderInsertions/, 'dropping into Blue must render the inserted asset rather than only showing a toast');
});

test('V6 exposes truthful interaction-memory undo and a visible hand runtime failure', () => {
  assert.match(renderer, /Undo last interaction reference[\s\S]*?window\.solat\.multimodalUndo/);
  assert.match(renderer, /state === 'error'[\s\S]*?Hand tracking stopped/);
});

test('V2 keeps every V1 static button while retiring the visible music lane', () => {
  const v1ButtonIds = [...v1.matchAll(/<button\b[^>]*\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  assert.ok(v1ButtonIds.length >= 20, 'V1 button inventory unexpectedly changed');
  for (const id of v1ButtonIds.filter(id => id !== 'replayBtn')) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `V2 is missing V1 button #${id}`);
  }
  assert.match(html, /id=["']musicInput["']/i, 'V2 is missing the V1 music context input');
  assert.match(html, /id=["']musicPreview["']/i, 'V2 is missing the V1 music preview region');
  assert.match(html, /\.music-panel\s*\{\s*display:\s*none\s*!important;/i, 'retired music lane must not be visible');
  assert.match(renderer, /data-music-action/, 'music action controls must be wired');
  const v1DynamicMarkers = [...new Set([
    ...[...v1.matchAll(/data-music-[a-z0-9_-]+/gi)].map(match => match[0]),
    ...[...v1.matchAll(/data-solat-[a-z0-9_-]+/gi)].map(match => match[0]),
    'data-thinking',
  ])];
  for (const marker of v1DynamicMarkers) {
    assert.match(renderer, new RegExp(marker), `V2 is missing V1 music action ${marker}`);
  }
  assert.match(html, /src="\.\/speech-chunker\.js\?v=1"/, 'streaming speech must load the deterministic sentence chunker');
  assert.match(html, /src="\.\/voice-controller\.js\?v=2"/, 'voice mode must load the isolated voice controller');
  assert.match(voiceController, /getUserMedia\([\s\S]*?echoCancellation:\s*true/, 'voice capture must use the browser media path with echo cancellation');
  assert.match(voiceController, /Float32Array[\s\S]*?voicePushSTT\(/, 'voice capture must stream PCM chunks through the secure preload bridge');
  assert.match(voiceController, /utterance_id[\s\S]*?finalUtterances\.has[\s\S]*?finalUtterances\.add/, 'final transcripts must be deduplicated before brain dispatch');
  assert.match(voiceController, /setState\('interrupted'\)[\s\S]*?voiceCancelTTS/, 'barge-in must leave speaking before asynchronous provider cancellation so overlapping audio frames cannot race');
  for (const state of ['idle', 'listening', 'user_speaking', 'transcribing', 'thinking', 'acting', 'speaking', 'interrupted', 'error']) {
    assert.match(voiceController, new RegExp(`'${state}'`), `voice state machine is missing ${state}`);
  }
  assert.match(renderer, /const state = \['idle', 'listening', 'user_speaking', 'transcribing', 'thinking', 'acting', 'speaking', 'interrupted', 'error'\]\.includes\(next\)/, 'Blue UI projection must accept exactly the real V1 state contract');
  assert.match(renderer, /scene\.dataset\.voiceState = state/, 'Blue UI must expose the exact V1 state instead of deriving a second voice state machine');
  assert.match(renderer, /state === 'speaking' \? 'SOLAT SPEAKING'/, 'the speaking state must identify SOLAT as the speaker');
  assert.match(renderer, /onState: state => \{[\s\S]*?setSolatVoiceActivity\(state\)/, 'the Blue UI must project controller events directly');
  assert.match(renderer, /#solatVoiceMicButton'[\s\S]*?toggleVoiceInput/, 'Blue microphone control must use the existing Voice toggle path');
  assert.match(renderer, /voiceMic\.setAttribute\('aria-pressed', String\(listening\)\)/, 'Blue microphone control must reflect the real listening states');
  assert.match(renderer, /onFinalTranscript:[\s\S]*?await Chat\.submitVoiceTurn\(transcript, \{[\s\S]*?voiceSessionId:[\s\S]*?voiceFinalAtMs:/, 'a final voice transcript must enter the unified voice-turn input path with its verified timestamp');
  assert.doesNotMatch(renderer, /onFinalTranscript:[\s\S]{0,400}input\.value\s*=\s*''/, 'a voice turn must not be submitted by clearing and reusing the typed Red composer');
  assert.match(renderer, /submitVoiceTurn\(transcript, voice = \{\}\)[\s\S]*?submitUnifiedTurn\(\{ kind: 'voice'/, 'voice input must share the unified SOLAT input boundary instead of the typed chat path');
  assert.match(renderer, /onPartial:[\s\S]*?setSolatVoicePreview\(value\)/, 'partial transcripts stay ephemeral UI feedback instead of becoming a typed message');
  assert.doesNotMatch(renderer, /onPartial:[\s\S]{0,220}input\.value\s*=\s*transcript/, 'partial transcripts must not be typed into the Red composer');
  assert.match(renderer, /role: 'user', content: visible, source: inputKind/, 'every submitted turn records whether it arrived as text or voice');
  assert.match(renderer, /if \(Voice\?\.active\)[\s\S]*?Voice\.speak\(text\(result\.assistant\)/, 'only the visible normal SOLAT response may enter TTS');
  assert.match(renderer, /receiveComputerTaskEvent[\s\S]*?solatVoiceController\?\.markActing\(\)/, 'real Computer Use progress must drive the acting state');
  assert.match(renderer, /dragenter|dataTransfer/, 'file drag-and-drop must be wired');
  assert.match(renderer, /openSettings|SettingsUI/, 'settings UI must be wired');
  assert.match(renderer, /Menu\.open|Palette\.open/, 'menus and command palette must be wired');
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i, 'renderer must not reintroduce V1 HTTP calls');
  assert.doesNotMatch(renderer, /(?:127\.0\.0\.1|localhost):\d+/i, 'renderer must not depend on a manual port');
});

test('completed turns clear the thinking bubble before the final render', () => {
  assert.match(renderer, /minimumActivityMs\s*=\s*Settings\.get\('motion'\)\s*\?\s*620\s*:\s*0/, 'thinking activity must remain visible long enough to read');
  assert.match(renderer, /class:\s*'bubble thinking-bubble'/, 'pending response must render inside a compact message bubble');
  assert.match(renderer, /text:\s*'Thinking'/, 'pending response must have a readable state label');
  assert.match(
    renderer,
    /finally\s*\{[\s\S]*Chat\.controller\s*=\s*null;\s*Composer\.setBusy\(false\);[\s\S]*Chat\.render\(\);/,
    'the request cleanup must happen before rendering the completed turn',
  );
});

test('tool-grounded response sources are carried to the visible source disclosure', () => {
  assert.match(renderer, /function responseSources\(value\)/);
  assert.match(renderer, /message\.responseMeta\?\.sources/);
  assert.match(renderer, /function restrictAssistantLinks\(node, sources\)/);
  assert.match(renderer, /Only URLs returned\s+\/\/ by the validated search tool are rendered/);
  assert.match(renderer, /source scope/);
  assert.match(renderer, /data-search-provider-status/);
  assert.match(renderer, /data-source-count/);
  assert.match(renderer, /data-source-disclosure/);
  assert.match(renderer, /Sources\s*·\s*\$\{block\.sources\.length\}/);
  assert.match(renderer, /comparison_split_evidence/);
  assert.match(renderer, /comparison evidence incomplete/);
  assert.match(renderer, /searchSummary/);
  assert.match(renderer, /summary\.source_authority_level/);
  assert.match(renderer, /summary\.source_corroboration/);
  assert.match(renderer, /summary\.source_agreement_status/);
  assert.match(renderer, /data-platform-coverage/);
  assert.match(renderer, /newest evidence-bearing run/);
  assert.match(renderer, /const displayStatus = status \|\| text\(latestEvidence\.status \|\| 'unknown'\)/);
  assert.match(renderer, /authorityLevel === 'social_discovery'/);
  assert.match(renderer, /authorityLevel === 'video_discovery'/);
  assert.match(renderer, /authorityLevel === 'ai_summary'/);
  assert.match(renderer, /latestEvidence\.status = `\$\{displayStatus\}\$\{authorityLabel\}`/);
  assert.match(renderer, /sources: Array\.isArray\(result\.sources\) \? result\.sources : \[\]/);
  assert.match(renderer, /sourceDisclosure\(\{ sources, blockedCount: 0 \}\)/);
  assert.match(renderer, /multiple source hosts/);
  assert.match(renderer, /agreement not assessed/);
  assert.match(renderer, /one source host/);
  assert.match(renderer, /summary\.search_requested/);
  assert.match(renderer, /tool available but not used/);
});

test('music deck action crosses the secure IPC boundary without a renderer provider call', () => {
  assert.match(renderer, /window\.solat\.createDeck/);
  assert.match(renderer, /data-solat-deck-generator/);
  assert.match(main, /createSolatServices\(\{ config, userDataDir, tempDir: app\.getPath\('temp'\), browserWorkspacePort \}\)/);
  assert.match(main, /registerSolatIpc\(\{/);
  assert.doesNotMatch(main, /ipcMain\.handle\(/, 'IPC handlers belong in the extracted router, not the Electron shell');
  assert.match(ipcRouter, /ipcMain\.handle\('solat:create-deck'/);
  assert.match(services, /new CreativeWorkflow/);
  assert.match(preload, /createDeck: async request/);
  assert.match(preload, /storeOriginalAsset: async request/);
  assert.match(preload, /exportHtml: async request/);
  assert.match(preload, /openExport: async request/);
  assert.match(preload, /inspectExport: async request/);
  assert.match(preload, /loadCreativeHistory: async request/);
  assert.match(preload, /saveConversation: async request/);
  assert.match(preload, /loadConversation: async request/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:store-original-asset'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:export-html'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:open-export'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:inspect-export'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:load-creative-history'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:save-conversation'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:load-conversation'/);
  assert.match(ipcRouter, /creativePersistence\.saveResult/);
  assert.match(renderer, /window\.solat\.storeOriginalAsset/);
  assert.match(renderer, /window\.solat\.exportHtml/);
  assert.match(renderer, /assets: Array\.isArray\(previousUser\?\.assetIds\) \? previousUser\.assetIds : \[\]/);
  assert.match(services, /new CreativeWorkflow\(\{ provider: core\.provider, workspace: core\.workspace \}\)/);
  assert.match(renderer, /previewDeck\(\)/);
  assert.match(renderer, /if \(action === 'slides'\) return this\.previewDeck\(\)/);
  assert.match(renderer, /if \(action === 'revise'\) return this\.reviseDeck\(\)/);
  assert.match(renderer, /if \(action === 'history'\) return this\.revisionHistory\(\)/);
  assert.match(renderer, /if \(action === 'open'\) return this\.openExport\(\)/);
  assert.match(renderer, /window\.solat\.openExport/);
  assert.match(renderer, /window\.solat\.inspectExport/);
  assert.match(renderer, /window\.solat\.loadCreativeHistory/);
  assert.match(renderer, /saveConversation/);
  assert.match(renderer, /loadConversation/);
  assert.match(renderer, /sessionStorageKey/);
  assert.match(renderer, /data-solat-export-inspection/);
  assert.match(ipcRouter, /revision_of: result\.revisionOf \|\| null/);
  assert.doesNotMatch(renderer, /(?:127\.0\.0\.1|localhost):\d+/i);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
});

test('opening SOLAT has no external application startup side effect', () => {
  assert.doesNotMatch(main, /(?:calc|calculator|notepad|chrome)\.exe(?:['"]|\s|$)/iu);
  assert.doesNotMatch(main, /(?:spawn|exec|execFile|launchApp)\s*\(/u);
  assert.match(main, /openInChrome:\s*async url\s*=>/u);
  assert.match(browserManager, /if \(action === 'open_chrome'\) \{[\s\S]*?#openCurrentInChrome/u);
});

test('command palette uses Ctrl+G consistently', () => {
  assert.match(renderer, /modifier && event\.key\.toLowerCase\(\) === 'g'[\s\S]*?Palette\.open\(\)/u);
  assert.doesNotMatch(renderer, /modifier && event\.key\.toLowerCase\(\) === 'k'[\s\S]*?Palette\.open\(\)/u);
  assert.match(html, /id="omniKbd">Ctrl\+G</u);
});

test('Chrome Control keeps only its setup title in Persona font', () => {
  assert.match(html, /#chromeControlSetup \.dlg-body,[\s\S]*?#chromeControlTitle \.sub\s*\{[\s\S]*?font-family:\s*var\(--f-plain\)\s*!important/u);
  assert.match(html, /#chromeControlTitle\s*\{\s*font-family:\s*var\(--f-persona\)\s*!important/u);
});

test('always-on chat-integrated Agent commands and approval flow use the narrow IPC bridge', () => {
  for (const id of ['agentCommandMenu', 'agentDialog', 'agentApproveBtn', 'agentCancelBtn', 'agentStatus', 'agentProgress', 'agentProgressLabel']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing agent control #${id}`);
  }
  assert.doesNotMatch(html, /id="agentCommandBtn"/, 'Agent is always available and must not require a mode toggle');
  assert.match(html, /data-agent-command="create-file"/);
  assert.match(html, /data-agent-command="computer-use"/);
  assert.match(html, /role="menuitemradio" aria-checked="false" data-agent-command="create-file"/);
  assert.match(html, /\.agent-command-menu button\[aria-checked="true"\]/);
  assert.match(html, /\.agent-command-trigger\.active[\s\S]*?background:\s*var\(--solat-red\)\s*!important/);
  assert.doesNotMatch(html, /agent-toggle-label/);
  assert.match(html, /Agent approval/);
  assert.match(html, /class="agent-progress-orbit"/);
  assert.match(html, /\.agent-file-card\s*\{/);
  assert.doesNotMatch(html, /id="agentCreateBtn"|id="agentRunBtn"/);
  assert.match(renderer, /const AgentUI\s*=\s*\{/);
  assert.match(renderer, /enabled:\s*true/);
  assert.match(renderer, /isEnabled\(\)\s*\{\s*return true;\s*\}/);
  assert.doesNotMatch(renderer, /agentCommandBtn/);
  assert.match(renderer, /agentMode:\s*true/);
  assert.doesNotMatch(html, /class="live-dots"/);
  assert.doesNotMatch(html, /:root\.not\(\.home-mode\) #composer \.row \{[^}]*box-shadow:\s*7px\s+7px\s+0/);
  assert.doesNotMatch(html, /@keyframes composer(?:Breath|Focus)[^}]*box-shadow:\s*(?:7px|10px)/);
  assert.match(renderer, /Previous Computer Use action was replaced by your newer instruction/);
  assert.match(renderer, /computerTaskId\s*&&\s*action\.sessionId === context\.sessionId/);
  assert.match(renderer, /Array\.isArray\(result\.agentActions\)/);
  assert.match(renderer, /agentActionPending/);
  assert.match(renderer, /canReview\(message\)/, 'only the current pending Agent plan may remain clickable');
  assert.match(renderer, /Action unavailable/, 'historical Agent plans must not look interactive');
  assert.match(renderer, /agentActionStatus: status/, 'completed/cancelled/failed plans must clear their pending action affordance');
  assert.match(html, /\.act:disabled,[\s\S]*?cursor:\s*default/, 'expired action buttons need a truthful inert style');
  assert.match(renderer, /agentStatus:\s*statusOverride\s*\|\|\s*\(error\s*\?\s*'failed'\s*:\s*'verified'\)/);
  assert.match(renderer, /Completed · verified/);
  assert.match(html, /.msg.agent-verified/);
  assert.match(renderer, /window\.solat\.agentInspect/);
  assert.match(renderer, /window\.solat\.agentApprove/);
  assert.match(renderer, /window\.solat\.agentRun/);
  assert.match(renderer, /window\.solat\.agentCancel/);
  assert.doesNotMatch(renderer, /form\.addEventListener\('submit',[^\n]*if \(busy\) return Chat\.stop/, 'form submission must reach the owner-steering gate while a computer task is active');
  assert.match(renderer, /latestRevisionByTask/, 'late task events must be rejected by revision');
  assert.match(renderer, /latestRequestBySession/, 'late task events must also be rejected by request id');
  assert.match(renderer, /terminalTaskTombstones/, 'a terminal task must retain a bounded revision tombstone');
  assert.match(renderer, /AgentUI\.beginRequest\(/, 'a newer chat request must clear stale pending UI for its session');
  assert.match(renderer, /if \(terminal\) \{[\s\S]*activeTaskBySession\.delete/u, 'a terminal event must never reactivate a finished task');
  assert.match(renderer, /while \(this\.terminalTaskTombstones\.size > 512\)/u, 'terminal task tombstones must remain bounded');
  assert.match(renderer, /if \(!activeTask && !terminal && event\.type !== 'started'\) return/u, 'a delayed nonterminal event must not resurrect a retired task');
  assert.match(renderer, /if \(terminal && activeTask === event\.task_id\)[\s\S]*activeTaskBySession\.delete/u, 'a stale terminal event may safely retire only its matching active task');
  assert.match(renderer, /computerTaskRequestId:\s*event\.request_id/u, 'progress messages must retain request identity for reconciliation');
  assert.match(renderer, /reconcileComputerTaskResponse\([\s\S]*State\.removeMessage\(threadId, message\.id\)/u, 'the final response must merge with and remove its duplicate progress message');
  assert.match(renderer, /State\.updateMessage\(threadId, this\.pending\.messageId[\s\S]*State\.removeMessage\(threadId, progressMessageId/u, 'verified Computer Use output must replace its request message and remove the progress duplicate');
  assert.match(renderer, /const terminalTask = \['COMPLETED',[\s\S]*if \(terminalTask\)[\s\S]*rememberTerminalTask/u, 'only a genuinely terminal task result may create a terminal tombstone');
  assert.match(renderer, /addChatResult\(message, taskFailed, this\.artifactFromPlan\(this\.plan\), null, taskStatus\)/u, 'the approval flow must pass the actual task status into result reconciliation');
  assert.match(renderer, /computerTaskSessionId/, 'task cancellation must use the message-bound session');
  assert.match(renderer, /const continuation = window\.solat\.computerTaskApproveAndContinue[\s\S]*?Overlay\.close\(\);[\s\S]*?await this\.awaitComputerTaskContinuation\(continuation, pending\)/, 'approval modal must close before the bounded continuation is reconciled');
  assert.match(renderer, /awaitComputerTaskContinuation\(continuation, pending\)/, 'computer task approval must reconcile against the durable terminal task state');
  assert.match(preload, /computerTaskInspect:[\s\S]*?solat:computer-task-inspect/, 'renderer must expose read-only computer task inspection for terminal reconciliation');
  assert.match(renderer, /window\.solat\.agentReadArtifact/);
  assert.match(renderer, /agentFile:/);
  assert.match(renderer, /Creating .*\u2026|Creating .*…/);
  assert.match(renderer, /remainingAnimationMs = 600/);
  assert.match(renderer, /class:\s*'agent-artifact-content'/);
  assert.match(renderer, /class:\s*'agent-artifact-preview'/);
  assert.match(renderer, /text: 'Code'/);
  assert.match(renderer, /text: 'Preview'/);
  assert.match(renderer, /text: 'Download'/);
  assert.match(renderer, /preview\.srcdoc = result\.content/);
  assert.match(renderer, /sandbox: ''/);
  assert.match(html, /\.agent-artifact-preview\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(renderer, /window\.solat\.agentExportArtifact/);
  assert.match(renderer, /actionSummary\(action\)/);
  assert.match(renderer, /stepSummary\(step\)/);
  assert.doesNotMatch(renderer, /result\.textContent = value \? JSON\.stringify\(value, null, 2\)/);
  assert.match(renderer, /AgentUI\.handleInput\(input\.value\)/);
  assert.match(renderer, /if \(\/\(\?:\^\|\\s\)@\[a-z-\]\*\$\/iu\.test\(current\)\) this\.openMenu\(\)/);
  assert.match(renderer, /#composer'\)\?\.classList\.add\('agent-on'\)/);
  assert.doesNotMatch(renderer, /toggle\(\)\s*\{[\s\S]*?this\.enabled\s*=\s*!this\.enabled/);
  assert.match(renderer, /agentCommand:\s*AgentUI\.commandFromText\(visible\)/);
  assert.match(renderer, /commandFromText\(value\)/);
  assert.match(renderer, /@\$\{command\} inserted\./);
  assert.match(html, /#input\.has-agent-command\s*\{[^}]*var\(--f-mono\)/);
  assert.match(renderer, /data-agent-command/);
  assert.match(renderer, /addEventListener\('pointerdown', chooseCommand\)/);
  assert.match(renderer, /lastCommandSelectionAt/);
  assert.match(renderer, /await window\.solat\.agentApprove[\s\S]*await window\.solat\.agentRun/);
  assert.match(renderer, /AGENT ON/);
  assert.doesNotMatch(renderer, /window\.solat\.agentCreate/);
  assert.match(preload, /agentCreate: async request/);
  assert.match(preload, /agentInspect: async request/);
  assert.match(preload, /agentApprove: async request/);
  assert.match(preload, /agentRun: async request/);
  assert.match(preload, /agentReadArtifact: async request/);
  assert.match(preload, /agentExportArtifact: async request/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-create'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-inspect'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-approve'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-run'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-read-artifact'/);
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-export-artifact'/);
  assert.match(ipcRouter, /artifact\.sha256 !== expectedSha256/);
  assert.match(ipcRouter, /previewLimit = 200000/);
  assert.match(renderer, /actionScopeLine\(scope\)/, 'approval dialog must derive a visible scope line');
  assert.match(renderer, /Approved scope: \$\{scopeLine\}/, 'approval dialog must state the approved scope, not goal keywords');
  assert.match(ipcRouter, /ipcMain\.handle\('solat:agent-interrupted-plans'/);
  assert.match(preload, /agentInterruptedPlans: async request/);
  assert.match(renderer, /reportInterrupted\(thread\.id\)/, 'interrupted durable plans must be surfaced after a restart');
  assert.match(renderer, /were interrupted and not run again automatically/, 'interrupted tasks must be reported honestly');
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
});
