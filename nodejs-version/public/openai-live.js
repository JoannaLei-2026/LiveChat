// Browser media stays on WebRTC; the application server only exchanges the SDP offer.
window.OpenAILiveConnection = class OpenAILiveConnection {
  constructor({ onStatus, onTranscript, onError }) {
    this.onStatus = onStatus;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.audio.controls = true;
    this.audio.style.display = 'none';
    document.querySelector('.voice-controller-area').appendChild(this.audio);
    this.ready = false;
    this.starting = false;
    this.generation = 0;
  }

  async start(instructions) {
    if (this.closing) await this.closed;
    if (this.ready || this.starting) return;
    const generation = ++this.generation;
    this.starting = true;
    this.onStatus(false, 'GPT-Live 連線中...');
    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.addEventListener('track', ({ track }) => {
        this.audio.srcObject = new MediaStream([track]);
        this.audio.play().catch(() => {
          this.audio.style.display = 'block';
          this.onStatus(this.ready, '請點擊播放以聆聽 GPT-Live');
        });
      });
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) {
        microphone.getTracks().forEach(track => track.stop());
        return;
      }
      this.microphone = microphone;
      this.microphone.getAudioTracks().forEach(track => peer.addTrack(track, this.microphone));
      const events = peer.createDataChannel('oai-events');
      this.events = events;
      events.addEventListener('message', ({ data }) => {
        if (generation !== this.generation) return;
        try {
          const event = JSON.parse(data);
          if (event.type === 'session.started') {
            clearTimeout(this.startTimer);
            this.ready = true;
            this.starting = false;
            this.onStatus(true, 'GPT-Live 已連線');
          } else if (event.type === 'session.input_transcript.delta') {
            this.onTranscript('user', event.delta, event.start_ms);
          } else if (event.type === 'session.output_transcript.delta') {
            this.onTranscript('ai', event.delta, event.start_ms);
          } else if (event.type === 'session.closed') {
            this.cleanup();
            this.onStatus(false, 'GPT-Live 對話已結束');
          } else if (event.type === 'error') {
            this.onError(event.error?.message || 'GPT-Live 發生錯誤');
          }
        } catch (error) {
          console.error('[OpenAI Live] Event error:', error);
        }
      });
      events.addEventListener('close', () => {
        if (generation === this.generation && !this.closing) {
          this.cleanup();
          this.onStatus(false, 'GPT-Live 連線中斷');
        }
      });
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            peer.removeEventListener('icegatheringstatechange', check);
            reject(new Error('ICE 連線準備逾時'));
          }, 10000);
          function check() {
            if (peer.iceGatheringState !== 'complete') return;
            clearTimeout(timeout);
            peer.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
          peer.addEventListener('icegatheringstatechange', check);
          check();
        });
      }
      if (generation !== this.generation) return;
      this.abortController = new AbortController();
      const response = await fetch('/api/openai/live-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: peer.localDescription.sdp, instructions }),
        signal: this.abortController.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '建立 GPT-Live 會話失敗');
      if (generation !== this.generation) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
      // The HTTP request starts the session. Wait for session.started on the data channel.
      this.startTimer = setTimeout(() => {
        if (generation !== this.generation || this.ready) return;
        this.cleanup();
        this.onStatus(false, 'GPT-Live 連線逾時');
        this.onError('未收到 session.started，請重試。');
      }, 15000);
    } catch (error) {
      if (generation === this.generation) {
        this.cleanup();
        this.onStatus(false, 'GPT-Live 連線失敗');
        this.onError(error.message || String(error));
      }
    }
  }

  setMuted(muted) {
    this.audio.muted = muted;
  }

  stop() {
    if (this.ready && this.events?.readyState === 'open') {
      this.ready = false;
      this.closing = true;
      this.closed = new Promise(resolve => { this.resolveClosed = resolve; });
      this.onStatus(false, 'GPT-Live 正在結束對話...');
      this.events.send(JSON.stringify({ type: 'session.close' }));
      this.closeTimer = setTimeout(() => {
        this.cleanup();
        this.onStatus(false, 'GPT-Live 結束逾時');
      }, 15000);
    } else {
      this.cleanup();
    }
  }

  cleanup() {
    ++this.generation;
    clearTimeout(this.startTimer);
    clearTimeout(this.closeTimer);
    this.abortController?.abort();
    this.microphone?.getTracks().forEach(track => track.stop());
    this.events?.close();
    this.peer?.close();
    this.audio.srcObject = null;
    this.audio.style.display = 'none';
    this.ready = false;
    this.starting = false;
    this.closing = false;
    this.microphone = null;
    this.events = null;
    this.peer = null;
    this.resolveClosed?.();
    this.resolveClosed = null;
  }
};
