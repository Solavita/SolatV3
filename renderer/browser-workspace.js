(() => {
  'use strict';
  const bridge = window.solatBrowserShell;
  const address = document.getElementById('address');
  const state = document.getElementById('state');
  const privacy = document.getElementById('privacy');
  const hint = document.getElementById('hint');
  const takeover = document.getElementById('takeover');
  let surface = null;
  bridge.onState(event => {
    if (event?.surface) surface = event.surface;
    if (surface?.url && document.activeElement !== address) address.value = surface.url;
    const privateInput = surface?.privacy === 'shielded';
    privacy.classList.toggle('on', privateInput);
    state.textContent = privateInput ? 'PRIVATE' : String(surface?.status || event?.type || 'READY').toUpperCase();
    takeover.textContent = surface?.control === 'user' ? 'Return control' : 'Take control';
    takeover.classList.toggle('user', surface?.control === 'user');
    hint.textContent = surface?.external_auth === 'chrome_google'
      ? 'Opened in Chrome · click Continue with Google there; login stays private in Chrome'
      : surface?.external_auth === 'unavailable'
        ? 'Google sign-in requires installed Chrome'
        : privateInput
      ? 'Password and one-time-code fields are hidden from SOLAT observation and capture'
      : surface?.popup === 'open' ? 'A login or site popup is open · close it before returning control'
        : surface?.control === 'user' ? 'You control this page · popups and downloads are available' : 'SOLAT control · click the page to take over';
  });
  const command = action => bridge.command(action, surface ? { sessionId: surface.session_id, surfaceId: surface.surface_id } : {})
    .catch(error => { state.textContent = String(error?.code || 'ERROR').replace(/^browser_/u, '').toUpperCase(); });
  document.getElementById('back').addEventListener('click', () => command('back'));
  document.getElementById('forward').addEventListener('click', () => command('forward'));
  document.getElementById('reload').addEventListener('click', () => command('reload'));
  document.getElementById('openChrome').addEventListener('click', () => command('open_chrome'));
  document.getElementById('close').addEventListener('click', () => command('close'));
  document.getElementById('selectAsset').addEventListener('click', () => {
    bridge.command('select_asset', surface ? { sessionId: surface.session_id, surfaceId: surface.surface_id } : {})
      .then(result => { if (result?.status === 'held') state.textContent = 'IMAGE HELD'; })
      .catch(() => { state.textContent = 'ALT-CLICK IMAGE FIRST'; });
  });
  takeover.addEventListener('click', () => command(surface?.control === 'user' ? 'return_control' : 'takeover'));
  address.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !surface) return;
    event.preventDefault();
    state.textContent = 'NAVIGATING';
    address.blur();
    bridge.command('navigate', { sessionId: surface.session_id, surfaceId: surface.surface_id, url: address.value })
      .catch(error => { state.textContent = String(error?.code || 'INVALID ADDRESS').replace(/^browser_/u, '').toUpperCase(); address.focus(); address.select(); });
  });
})();
