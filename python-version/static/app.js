document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const personaModal = document.getElementById('personaModal');
  const customPersonaInput = document.getElementById('customPersonaInput');
  const btnSavePersona = document.getElementById('btnSavePersona');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnChangePersona = document.getElementById('btnChangePersona');
  const currentPersonaText = document.getElementById('currentPersonaText');
  const providerSelect = document.getElementById('providerSelect');
  const modelBadge = document.getElementById('modelBadge');

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const chatWindow = document.getElementById('chatWindow');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const presetCards = document.querySelectorAll('.preset-card');

  // Voice & Mic Elements
  const btnVoiceToggle = document.getElementById('btnVoiceToggle');
  const voiceToggleIcon = document.getElementById('voiceToggleIcon');
  const voiceToggleText = document.getElementById('voiceToggleText');
  const btnMicToggle = document.getElementById('btnMicToggle');
  const micIcon = document.getElementById('micIcon');
  const micText = document.getElementById('micText');
  const btnMicMain = document.getElementById('btnMicMain');
  const mainMicIcon = document.getElementById('mainMicIcon');
  const mainMicText = document.getElementById('mainMicText');
  const waveBars = document.querySelectorAll('.wave-bar');
  const waveStatusText = document.getElementById('waveStatusText');

  let ws = null;
  let currentProvider = 'gemini';
  const openAiCaptions = { user: null, ai: null };
  const openAiCaptionTimes = { user: -Infinity, ai: -Infinity };
  const openAiLive = new window.OpenAILiveConnection({
    onStatus: (connected, label) => {
      if (currentProvider !== 'openai') return;
      updateStatus(connected, label);
      if (/失敗|中斷|結束|逾時/.test(label)) setOpenAiMicUi(false);
    },
    onError: message => appendSystemNotice(`⚠️ ${message}`),
    onTranscript: (role, delta, startMs) => {
      if (currentProvider !== 'openai' || !delta) return;
      if (!openAiCaptions[role] || startMs - openAiCaptionTimes[role] > 2000) {
        const row = document.createElement('div');
        row.className = `message ${role}`;
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.innerHTML = role === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-brain"></i>';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        row.append(avatar, bubble);
        chatWindow.appendChild(row);
        openAiCaptions[role] = bubble;
      }
      openAiCaptions[role].textContent += delta;
      openAiCaptionTimes[role] = startMs;
      scrollToBottom();
    }
  });
  let currentPersona = '';
  let activeAiBubble = null;
  let activeAiTextSpan = null;
  let isReceivingStream = false;
  let isRestFallbackMode = false;

  // Voice State
  let isVoiceEnabled = true; // Default: 全程語音 ON
  let isMicRecording = false;
  let mediaStream = null;
  let audioInputContext = null;
  let micProcessor = null;

  // Web Audio Output Player Context
  let audioOutputContext = null;
  let nextStartTime = 0;
  let activeAudioSources = [];

  // Show Modal on launch
  openModal(true);

  // Preset Card Clicks
  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.getAttribute('data-prompt');
      customPersonaInput.value = prompt;
    });
  });

  // Save Persona & Initialize Session
  btnSavePersona.addEventListener('click', () => {
    const persona = customPersonaInput.value.trim();
    if (!persona) {
      alert('請輸入或選擇一個對話角色 Prompt！');
      return;
    }

    currentPersona = persona;
    const previousProvider = currentProvider;
    currentProvider = providerSelect.value;
    if (previousProvider === 'openai') openAiLive.stop();
    if (ws) { ws.close(); ws = null; }
    if (isMicRecording && previousProvider === 'gemini') stopMicRecording();
    openAiCaptions.user = openAiCaptions.ai = null;
    openAiCaptionTimes.user = openAiCaptionTimes.ai = -Infinity;
    modelBadge.innerHTML = currentProvider === 'openai'
      ? '<i class="fa-solid fa-brain"></i> OpenAI GPT-Live'
      : '<i class="fa-solid fa-brain"></i> Gemini 3.1 Flash Live';
    btnVoiceGender.style.display = currentProvider === 'openai' ? 'none' : '';
    currentPersonaText.textContent = persona;
    closeModal();
    
    // Reset Chat Window
    chatWindow.innerHTML = '';
    appendSystemNotice(`已設定對話對象 Persona：「${persona}」`);

    // Connect / Re-init WebSocket
    if (currentProvider === 'openai') {
      openAiLive.setMuted(!isVoiceEnabled);
      updateStatus(false, 'GPT-Live 已就緒，點擊麥克風開始');
      setOpenAiMicUi(false);
    } else {
      initWebSocket(currentPersona);
    }
  });

  // Change Persona Button
  btnChangePersona.addEventListener('click', () => {
    openModal(false);
  });

  btnCancelModal.addEventListener('click', () => {
    closeModal();
  });

  let currentVoice = 'Puck'; // Default: 男聲 Puck
  const btnVoiceGender = document.getElementById('btnVoiceGender');
  const voiceGenderIcon = document.getElementById('voiceGenderIcon');
  const voiceGenderText = document.getElementById('voiceGenderText');

  if (btnVoiceGender) {
    btnVoiceGender.addEventListener('click', () => {
      if (currentVoice === 'Puck') {
        currentVoice = 'Aoede';
        voiceGenderIcon.className = 'fa-solid fa-venus-stroke';
        voiceGenderText.textContent = 'AI 聲音：女聲';
        appendSystemNotice('👩 已切換 AI 語音為「女聲 (Aoede)」');
      } else {
        currentVoice = 'Puck';
        voiceGenderIcon.className = 'fa-solid fa-mars-stroke';
        voiceGenderText.textContent = 'AI 聲音：男聲';
        appendSystemNotice('👨 已切換 AI 語音為「男聲 (Puck)」');
      }
      if (currentPersona) {
        initWebSocket(currentPersona);
      }
    });
  }

  // Voice Toggle Button Click
  btnVoiceToggle.addEventListener('click', () => {
    isVoiceEnabled = !isVoiceEnabled;
    if (currentProvider === 'openai') openAiLive.setMuted(!isVoiceEnabled);
    if (isVoiceEnabled) {
      btnVoiceToggle.className = 'btn btn-voice-toggle active';
      voiceToggleIcon.className = 'fa-solid fa-volume-high';
      voiceToggleText.textContent = '全程語音 ON';
      chatWindow.classList.remove('muted-mode');
      waveStatusText.textContent = '全程語音模式已啟用｜可使用麥克風或輸入文字對話';
      appendSystemNotice('🔊 已開啟全程語音對話模式：AI 將同步進行語音發聲與字幕顯示。');
    } else {
      btnVoiceToggle.className = 'btn btn-voice-toggle muted';
      voiceToggleIcon.className = 'fa-solid fa-volume-xmark';
      voiceToggleText.textContent = '靜音模式 (純對話)';
      chatWindow.classList.add('muted-mode');
      waveStatusText.textContent = '靜音模式｜對話內容已完整顯示於下方視窗';
      stopAudioPlayback();
      appendSystemNotice('🔇 已切換至靜音模式：已關閉語音播報，下方對話視窗已為您高亮展開對話紀錄。');
    }
  });

  // WebSocket Logic
  function initWebSocket(personaPrompt) {
    if (ws) {
      ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    updateStatus(false, '連線中...');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      updateStatus(true, 'Gemini 3.1 Flash Live Preview (Python) 連線成功');
      // Send Init Payload
      ws.send(JSON.stringify({
        type: 'init',
        systemInstruction: personaPrompt,
        voice: currentVoice,
        model: 'gemini-3.1-flash-live-preview'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'status') {
          isRestFallbackMode = !!(data.mode && data.mode.includes('REST'));
          updateStatus(data.connected, `Gemini 3.1 Flash Live Preview (${data.mode || 'Python Engine'})`);
        } else if (data.type === 'chunk') {
          handleStreamChunk(data.text);
        } else if (data.type === 'audio') {
          handleAudioChunk(data.data);
        } else if (data.type === 'end') {
          finalizeStream();
        } else if (data.type === 'error') {
          handleError(data.message);
        } else if (data.type === 'init_success') {
          console.log('Python Persona initialized successfully');
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
      updateStatus(false, '連線發生錯誤');
    };

    ws.onclose = () => {
      updateStatus(false, '連線已中斷');
      stopMicRecording();
    };
  }

  // Mic Toggle Handlers
  const toggleMicAction = async () => {
    if (currentProvider === 'openai') {
      if (!currentPersona) return openModal(true);
      if (openAiLive.closing) return;
      if (openAiLive.ready || openAiLive.starting) {
        openAiLive.stop();
        setOpenAiMicUi(false);
      } else {
        setOpenAiMicUi(true);
        await openAiLive.start(currentPersona);
      }
      return;
    }
    if (!isMicRecording) {
      await startMicRecording();
    } else {
      stopMicRecording();
    }
  };

  function setOpenAiMicUi(active) {
    isMicRecording = active;
    btnMicToggle.className = active ? 'btn btn-mic active' : 'btn btn-mic';
    micIcon.className = active ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
    micText.textContent = active ? '結束 GPT-Live 通話' : '開啟麥克風';
    if (btnMicMain) {
      btnMicMain.className = active ? 'btn btn-mic-main active' : 'btn btn-mic-main';
      mainMicIcon.className = micIcon.className;
      mainMicText.textContent = active ? 'GPT-Live 通話中 (點擊結束)' : '點擊開啟麥克風，開始全程語音對話';
    }
  }

  btnMicToggle.addEventListener('click', toggleMicAction);
  if (btnMicMain) {
    btnMicMain.addEventListener('click', toggleMicAction);
  }

  // Audio Playback Handler (24kHz PCM from Live Chat)
  function handleAudioChunk(base64Audio) {
    if (!isVoiceEnabled) return; // Mute mode active, ignore audio playback

    try {
      if (!audioOutputContext) {
        audioOutputContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      }

      if (audioOutputContext.state === 'suspended') {
        audioOutputContext.resume();
      }

      // Convert Base64 to ArrayBuffer
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 16-bit PCM (Little Endian)
      const int16Array = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      // Create AudioBuffer
      const audioBuffer = audioOutputContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Create Source Node
      const source = audioOutputContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioOutputContext.destination);

      const currentTime = audioOutputContext.currentTime;
      if (nextStartTime < currentTime) {
        nextStartTime = currentTime;
      }

      source.start(nextStartTime);
      nextStartTime += audioBuffer.duration;
      activeAudioSources.push(source);
      hasPlayedPcmAudio = true; // Set flag to prevent Web Speech TTS double playback

      // Wave animation
      setWaveActive(true, 'AI 正在說話中...');
      source.onended = () => {
        const index = activeAudioSources.indexOf(source);
        if (index > -1) activeAudioSources.splice(index, 1);
        if (activeAudioSources.length === 0) {
          setWaveActive(false, isVoiceEnabled ? '全程語音對話進行中' : '靜音模式 (純字幕對話)');
        }
      };

    } catch (e) {
      console.error('Audio chunk playback error:', e);
    }
  }

  function stopAudioPlayback() {
    activeAudioSources.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeAudioSources = [];
    nextStartTime = 0;
    flushTextSyncStream();
    setWaveActive(false, '已靜音');
  }

  // Web Speech API for User Live Subtitles
  let speechRecognition = null;

  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'zh-TW';

      let interimBubble = null;
      let interimSpan = null;

      rec.onresult = (event) => {
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            // Remove interim bubble and append permanent user bubble line by line
            if (interimBubble) {
              interimBubble.remove();
              interimBubble = null;
              interimSpan = null;
            }
            const finalText = transcript.trim();
            if (finalText) {
              appendUserMessage(finalText);
              // Send finalized text turn over WebSocket to guarantee Gemini response
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'message',
                  text: finalText
                }));
              }
              prepareAiBubble();
            }
          } else {
            interimText += transcript;
          }
        }

        if (interimText.trim()) {
          if (!interimBubble) {
            interimBubble = document.createElement('div');
            interimBubble.className = 'message user interim';
            interimBubble.innerHTML = `
              <div class="avatar"><i class="fa-solid fa-user"></i></div>
              <div class="bubble"><span></span><span class="typing-cursor"></span></div>
            `;
            chatWindow.appendChild(interimBubble);
            interimSpan = interimBubble.querySelector('.bubble span');
          }
          if (interimSpan) {
            interimSpan.textContent = interimText;
          }
          scrollToBottom();
        }
      };

      rec.onend = () => {
        interimBubble = null;
        interimSpan = null;
        if (isMicRecording) {
          try { rec.start(); } catch (e) {}
        }
      };

      return rec;
    } catch (e) {
      console.warn('SpeechRecognition init error:', e);
      return null;
    }
  }

  // Microphone Recording (16kHz PCM streaming to Live Chat)
  async function startMicRecording() {
    stopAudioPlayback(); // Interrupt any ongoing AI audio playback
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioInputContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioInputContext.state === 'suspended') {
        await audioInputContext.resume();
      }
      const sampleRate = audioInputContext.sampleRate;
      const source = audioInputContext.createMediaStreamSource(mediaStream);

      // Processor node (2048 buffer size for ~40ms ultra-low latency)
      micProcessor = audioInputContext.createScriptProcessor(2048, 1, 1);
      
      micProcessor.onaudioprocess = (e) => {
        if (!isMicRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);

        // Downsample to 16kHz
        const downsampled = resampleTo16kHz(inputData, sampleRate);
        const int16Buffer = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert Int16Array to Base64 accurately with byteOffset & byteLength
        const bytes = new Uint8Array(int16Buffer.buffer, int16Buffer.byteOffset, int16Buffer.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = window.btoa(binary);

        // Send audio frame over WS
        ws.send(JSON.stringify({
          type: 'audio',
          data: base64Audio
        }));
      };

      source.connect(micProcessor);
      micProcessor.connect(audioInputContext.destination);

      isMicRecording = true;

      // Start local speech-to-text recognition for immediate user subtitles
      if (!speechRecognition) {
        speechRecognition = initSpeechRecognition();
      }
      if (speechRecognition) {
        try { speechRecognition.start(); } catch (e) {}
      }

      // Update UI
      btnMicToggle.className = 'btn btn-mic active';
      micIcon.className = 'fa-solid fa-microphone';
      micText.textContent = '語音通話中';

      if (btnMicMain) {
        btnMicMain.className = 'btn btn-mic-main active';
        mainMicIcon.className = 'fa-solid fa-microphone';
        mainMicText.textContent = '麥克風通話中 (點擊結束通話)';
      }

      setWaveActive(true, '🎙️ 麥克風收音中... 請對著麥克風說話');
      appendSystemNotice('🎙️ 已開啟麥克風，您可以直接說話進行即時語音對話！');

    } catch (err) {
      console.error('Microphone access error:', err);
      alert('無法取得麥克風存取權限：' + err.message);
      stopMicRecording();
    }
  }

  function stopMicRecording() {
    isMicRecording = false;
    currentSpeechBubble = null;
    currentSpeechSpan = null;

    if (speechRecognition) {
      try { speechRecognition.stop(); } catch (e) {}
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor = null;
    }
    if (audioInputContext) {
      audioInputContext.close();
      audioInputContext = null;
    }

    btnMicToggle.className = 'btn btn-mic';
    micIcon.className = 'fa-solid fa-microphone-slash';
    micText.textContent = '開啟麥克風';

    if (btnMicMain) {
      btnMicMain.className = 'btn btn-mic-main';
      mainMicIcon.className = 'fa-solid fa-microphone-slash';
      mainMicText.textContent = '點擊開啟麥克風，開始全程語音對話';
    }

    setWaveActive(false, isVoiceEnabled ? '全程語音模式已就緒' : '靜音模式｜純字幕對話');
  }

  function resampleTo16kHz(audioBuffer, originSampleRate) {
    if (originSampleRate === 16000) return audioBuffer;
    const sampleRateRatio = originSampleRate / 16000;
    const newLength = Math.round(audioBuffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < audioBuffer.length; i++) {
        accum += audioBuffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  const btnInterrupt = document.getElementById('btnInterrupt');

  if (btnInterrupt) {
    btnInterrupt.addEventListener('click', () => {
      stopAudioPlayback();
      appendSystemNotice('🖐️ 已中途打斷 AI 發言');
    });
  }

  function setWaveActive(active, statusTextStr) {
    waveBars.forEach(bar => {
      if (active) bar.classList.add('speaking');
      else bar.classList.remove('speaking');
    });
    if (statusTextStr) {
      waveStatusText.textContent = statusTextStr;
    }
    if (btnInterrupt) {
      btnInterrupt.style.display = active ? 'inline-flex' : 'none';
    }
  }

  // Stream Handlers
  function prepareAiBubble() {
    isReceivingStream = true;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = '<i class="fa-solid fa-brain"></i>';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const textSpan = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';

    bubble.appendChild(textSpan);
    bubble.appendChild(cursor);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);

    chatWindow.appendChild(msgDiv);
    scrollToBottom();

    activeAiBubble = bubble;
    activeAiTextSpan = textSpan;
  }

  let hasPlayedPcmAudio = false;

  function speakText(text) {
    if (!('speechSynthesis' in window) || !isVoiceEnabled) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('SpeechSynthesis error:', e);
    }
  }

  let textSyncQueue = [];
  let textSyncTimer = null;

  function startTextSyncStream() {
    if (textSyncTimer) return;
    textSyncTimer = setInterval(() => {
      if (textSyncQueue.length > 0) {
        const char = textSyncQueue.shift();
        if (activeAiTextSpan) {
          activeAiTextSpan.textContent += char;
          scrollToBottom();
        }
      } else {
        clearInterval(textSyncTimer);
        textSyncTimer = null;
      }
    }, 28); // 28ms per char (~35 chars/sec), perfectly pacing text to match audio speech rate!
  }

  function flushTextSyncStream() {
    if (textSyncQueue.length > 0 && activeAiTextSpan) {
      activeAiTextSpan.textContent += textSyncQueue.join('');
      scrollToBottom();
      textSyncQueue = [];
    }
    if (textSyncTimer) {
      clearInterval(textSyncTimer);
      textSyncTimer = null;
    }
  }

  function handleStreamChunk(textChunk) {
    if (!textChunk) return;

    if (!activeAiTextSpan) {
      prepareAiBubble();
    }
    
    const currentDisplayedText = activeAiTextSpan.textContent + textSyncQueue.join('');
    let newText = textChunk;

    if (textChunk.startsWith(currentDisplayedText) && textChunk.length > currentDisplayedText.length) {
      newText = textChunk.slice(currentDisplayedText.length);
    } else if (currentDisplayedText.includes(textChunk)) {
      return;
    }

    for (let char of newText) {
      textSyncQueue.push(char);
    }

    startTextSyncStream();
  }

  function finalizeStream() {
    isReceivingStream = false;
    flushTextSyncStream();
    if (activeAiBubble) {
      const cursor = activeAiBubble.querySelector('.typing-cursor');
      if (cursor) cursor.remove();
      
      const fullText = activeAiTextSpan ? activeAiTextSpan.textContent.trim() : '';
      if (!fullText) {
        // Clean up empty AI bubble if no text arrived
        const msgDiv = activeAiBubble.closest('.message.ai');
        if (msgDiv) msgDiv.remove();
        activeAiBubble = null;
        activeAiTextSpan = null;
      } else {
        if (isRestFallbackMode && !hasPlayedPcmAudio) {
          speakText(fullText);
        }
        formatBubbleCode(activeAiTextSpan);
      }
    }
    hasPlayedPcmAudio = false;
  }

  function handleError(errorMessage) {
    isReceivingStream = false;
    if (activeAiBubble) {
      const cursor = activeAiBubble.querySelector('.typing-cursor');
      if (cursor) cursor.remove();
      activeAiTextSpan.innerHTML += `<br><span style="color:#ef4444;">⚠️ 錯誤：${escapeHtml(errorMessage)}</span>`;
    } else {
      appendSystemNotice(`⚠️ 錯誤：${errorMessage}`);
    }
    activeAiBubble = null;
    activeAiTextSpan = null;
  }

  // Helpers
  function appendUserMessage(text) {
    stopAudioPlayback(); // Interrupt any ongoing AI audio playback instantly
    // Reset AI active bubble reference for new user turn
    activeAiBubble = null;
    activeAiTextSpan = null;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = '<i class="fa-solid fa-user"></i>';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    chatWindow.appendChild(msgDiv);
    scrollToBottom();
  }

  function appendSystemNotice(text) {
    const noticeDiv = document.createElement('div');
    noticeDiv.style.textAlign = 'center';
    noticeDiv.style.fontSize = '0.82rem';
    noticeDiv.style.color = 'var(--accent-gold)';
    noticeDiv.style.margin = '12px 0';
    noticeDiv.style.opacity = '0.85';
    noticeDiv.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(text)}`;
    chatWindow.appendChild(noticeDiv);
    scrollToBottom();
  }

  function updateStatus(isOnline, text) {
    if (isOnline) {
      statusDot.className = 'status-dot online';
    } else {
      statusDot.className = 'status-dot offline';
    }
    statusText.textContent = text;
  }

  function openModal(isFirstLaunch) {
    personaModal.classList.add('active');
    btnCancelModal.style.display = isFirstLaunch ? 'none' : 'inline-flex';
  }

  function closeModal() {
    personaModal.classList.remove('active');
  }

  function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function formatBubbleCode(spanElement) {
    if (!spanElement) return;
    let content = spanElement.textContent;
    if (content.includes('```')) {
      const parts = content.split(/(```[\s\S]*?```)/g);
      spanElement.innerHTML = '';
      parts.forEach(part => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const rawCode = part.slice(3, -3).trim();
          const firstLineEnd = rawCode.indexOf('\n');
          let codeContent = rawCode;
          if (firstLineEnd !== -1) {
            codeContent = rawCode.substring(firstLineEnd + 1);
          }
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = codeContent;
          pre.appendChild(code);
          spanElement.appendChild(pre);
        } else {
          const textNode = document.createElement('span');
          textNode.textContent = part;
          spanElement.appendChild(textNode);
        }
      });
    }
  }
});
