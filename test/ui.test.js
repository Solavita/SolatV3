const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const ipcRouter = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc-router.js'), 'utf8');
const services = fs.readFileSync(path.join(__dirname, '..', 'src', 'services.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
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
  assert.match(html, /download-6\.jfif/i, 'blue UI mode art is missing');
  assert.match(html, /reblog-jakku-san-22-images-1\.jfif/i, 'red UI mode art is missing');
  assert.match(renderer, /classList\.contains\('ui-mode-toggle'\)/, 'settings must not replace UI mode art');
  assert.match(renderer, /localStorage\.setItem\('solat\.ui\.mode'/, 'UI mode must persist locally');
  assert.doesNotMatch(html, /\bfetch\s*\(/i, 'provider calls belong behind Electron IPC');
  assert.match(html, /\.msg:focus,\s*\.msg:focus-visible\s*\{\s*outline:\s*none;\s*\}/, 'programmatic message focus must not draw a blue frame');
  assert.match(renderer, /sessionId\s*=\s*createSessionId\(\)/, 'new conversation must isolate its session');
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
  assert.match(renderer, /SpeechRecognition|webkitSpeechRecognition/, 'dictation control must have a truthful capability path');
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
    /finally\s*\{[\s\S]*this\.controller\s*=\s*null;\s*Composer\.setBusy\(false\);[\s\S]*this\.render\(\);/,
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
  assert.match(main, /createSolatServices\(\{ config, userDataDir, tempDir: app\.getPath\('temp'\) \}\)/);
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

test('chat-integrated @ Agent commands and approval flow use the narrow IPC bridge', () => {
  for (const id of ['agentCommandBtn', 'agentCommandMenu', 'agentDialog', 'agentApproveBtn', 'agentCancelBtn', 'agentStatus', 'agentProgress', 'agentProgressLabel']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing agent control #${id}`);
  }
  assert.match(html, /id="agentCommandBtn"[^>]*aria-label="Enable Agent mode"[^>]*aria-pressed="false"[\s\S]*?<use href="#i-cpu"><\/use>[\s\S]*?<\/button>/);
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
  assert.match(renderer, /agentMode:\s*AgentUI\.isEnabled\(\)/);
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
  assert.match(renderer, /computerTaskSessionId/, 'task cancellation must use the message-bound session');
  assert.match(renderer, /const continuation = window\.solat\.computerTaskApproveAndContinue[\s\S]*?Overlay\.close\(\);[\s\S]*?await continuation/, 'approval modal must close before the bounded continuation is awaited');
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
  assert.match(renderer, /Agent mode is on/);
  assert.match(renderer, /#agentCommandBtn'\)\?\.addEventListener\('click', \(\) => this\.toggle\(\)\)/);
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
