// Keys are deliberately stored only on this browser's origin, separately by provider.
window.apiKeyStorage = {
  read(provider) {
    try { return localStorage.getItem(`livechat.apiKey.${provider}`) || ''; }
    catch { return ''; }
  },
  save(provider, key) {
    try { localStorage.setItem(`livechat.apiKey.${provider}`, key); return true; }
    catch { return false; }
  },
  clear(provider) {
    try { localStorage.removeItem(`livechat.apiKey.${provider}`); return true; }
    catch { return false; }
  }
};
