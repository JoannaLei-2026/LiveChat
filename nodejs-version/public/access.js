// Both providers acquire the same signed daily visitor admission before connecting.
let pendingAdmission;
window.ensureVisitorAccess = function () {
  if (!pendingAdmission) {
    pendingAdmission = fetch('/api/access', { method: 'POST' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '暫時無法開始對話，請稍後重試。');
    }).finally(() => { pendingAdmission = null; });
  }
  return pendingAdmission;
};
