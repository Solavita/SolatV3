(() => {
  'use strict';
  const state = document.getElementById('state');
  const detail = document.getElementById('detail');
  const pairingFragment = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const params = new URLSearchParams(pairingFragment);
  const endpoint = params.get('endpoint');
  const token = params.get('token');
  const render = value => {
    state.textContent = value.connected ? 'CONNECTED TO SOLAT' : value.configured ? 'PAIRED · SOLAT OFFLINE' : 'NOT PAIRED';
    detail.textContent = value.connected ? 'Normal Chrome tabs can now be controlled after private sign-in is complete.' : 'Open SOLAT and choose “Chrome Control setup” to pair.';
  };
  if (endpoint && token) {
    chrome.runtime.sendMessage({ type: 'pair', endpoint, token }, () => setTimeout(() => chrome.runtime.sendMessage({ type: 'status' }, render), 350));
  } else chrome.runtime.sendMessage({ type: 'status' }, render);
})();
