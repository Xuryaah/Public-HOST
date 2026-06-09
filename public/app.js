/* ==========================================================================
   VoiceMatch – Client-Side App Logic
   ========================================================================== */

const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const App = (() => {
  // ──────────── State variables ────────────
  let socket = null;
  let localStream = null;
  let preCallStream = null;
  let peerConn = null;
  
  let isMuted = false;
  let isDeafened = false;
  let isInitiator = false;
  let callSeconds = 0;
  let timerInterval = null;
  let tipsInterval = null;

  // Web Audio Contexts
  let audioCtxActive = null;
  let analyserActive = null;
  let animFrameActive = null;

  let audioCtxPre = null;
  let analyserPre = null;
  let animFramePre = null;

  // Custom User Profile Config
  const myProfile = {
    nickname: '',
    avatar: '👤',
    language: 'en',
    interests: []
  };

  let partnerProfile = null;

  // Data Arrays
  const AVATARS = ['👤','🎭','🦊','🐺','🐸','🦝','🐼','🐨','🦁','🎩','🤖','👾','👻','🦄','🐙','🐱','🐶'];
  
  const ADJECTIVES = ['Happy', 'Sleek', 'Quantum', 'Chill', 'Silent', 'Golden', 'Clever', 'Cosmic', 'Swift', 'Mystic', 'Neon', 'Echoing', 'Vibrant', 'Agile'];
  const NOUNS = ['Panda', 'Fox', 'Owl', 'Koala', 'Wolf', 'Sage', 'Tiger', 'Penguin', 'Falcon', 'Cheetah', 'Rabbit', 'Otter', 'Dolphin', 'Ninja'];
  
  const INTERESTS = ['Gaming', 'Music', 'Movies', 'Tech', 'Chill', 'Anime', 'Books', 'Art', 'Sports', 'Science', 'Coding', 'Travel'];

  const TIPS = [
    "Ask them what their favorite movie is, and why they can watch it multiple times.",
    "Share a funny story about the best or worst food you've eaten recently.",
    "Recommend headphones! Using headphones reduces audio echo and makes calls sound much crisper.",
    "If the conversation dries up, press [Space] to skip and meet someone new instantly.",
    "You can type links or spell hard-to-understand words in the live text chat on the right.",
    "Tell your partner one weird habit or interest you have that most people don't know.",
    "Ask them: 'If you could travel anywhere tomorrow for free, where would you go?'"
  ];

  // DOM elements
  let screens = {};

  // ──────────── Initialization ────────────
  function init() {
    // Cache screen refs
    screens = {
      idle:       document.getElementById('screen-idle'),
      searching:  document.getElementById('screen-searching'),
      connected:  document.getElementById('screen-connected'),
      ended:      document.getElementById('screen-ended'),
    };

    // Render configuration inputs on load
    generateNickname();
    renderAvatarSelector();
    renderInterestsSelector();
    setupKeyListeners();
    connectSocket();
  }

  // ──────────── Screen Nav ────────────
  function showScreen(name) {
    Object.keys(screens).forEach(key => {
      if (screens[key]) {
        screens[key].classList.remove('active');
      }
    });
    if (screens[name]) {
      screens[name].classList.add('active');
    }

    // Hide shortcut footer in idle/ended screens, show only in searching/connected
    const shortcutsBar = document.getElementById('shortcuts-bar');
    if (shortcutsBar) {
      if (name === 'connected' || name === 'searching') {
        shortcutsBar.style.display = 'flex';
      } else {
        shortcutsBar.style.display = 'none';
      }
    }
  }

  // ──────────── Profile Selectors ────────────
  function generateNickname() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const code = Math.floor(Math.random() * 90) + 10;
    const name = `${adj}${noun}${code}`;
    const input = document.getElementById('input-nickname');
    if (input) input.value = name;
    myProfile.nickname = name;
  }

  function renderAvatarSelector() {
    const container = document.getElementById('avatar-list');
    if (!container) return;
    container.innerHTML = '';
    
    // Choose initial random avatar
    const defaultIdx = Math.floor(Math.random() * AVATARS.length);
    myProfile.avatar = AVATARS[defaultIdx];

    AVATARS.forEach((av, idx) => {
      const el = document.createElement('div');
      el.className = 'avatar-item' + (AVATARS[defaultIdx] === av ? ' active' : '');
      el.textContent = av;
      el.onclick = () => {
        document.querySelectorAll('.avatar-item').forEach(item => item.classList.remove('active'));
        el.classList.add('active');
        myProfile.avatar = av;
      };
      container.appendChild(el);
    });
  }

  function renderInterestsSelector() {
    const container = document.getElementById('interests-container');
    if (!container) return;
    container.innerHTML = '';

    INTERESTS.forEach(interest => {
      const el = document.createElement('div');
      el.className = 'interest-chip';
      el.textContent = '#' + interest;
      el.onclick = () => {
        const idx = myProfile.interests.indexOf(interest);
        if (idx > -1) {
          myProfile.interests.splice(idx, 1);
          el.classList.remove('active');
        } else {
          if (myProfile.interests.length >= 3) {
            alert("Please choose a maximum of 3 interests.");
            return;
          }
          myProfile.interests.push(interest);
          el.classList.add('active');
        }
      };
      container.appendChild(el);
    });
  }

  // ──────────── Pre-Call Microphone Test ────────────
  async function testMicrophone() {
    stopPreCallTest();
    try {
      preCallStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      
      const badge = document.getElementById('mic-status-badge');
      const text = document.getElementById('mic-badge-text');
      const testBtn = document.getElementById('btn-test-mic');
      const overlayText = document.getElementById('pre-call-status');

      if (badge) {
        badge.className = 'mic-status-badge active';
        text.textContent = 'Mic Connected';
      }
      if (testBtn) testBtn.textContent = 'Retest';
      if (overlayText) overlayText.style.opacity = '0';

      // Start local pre-call wave analyser
      const canvas = document.getElementById('pre-call-visualizer');
      if (!canvas) return;

      audioCtxPre = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtxPre.createMediaStreamSource(preCallStream);
      analyserPre = audioCtxPre.createAnalyser();
      analyserPre.fftSize = 256;
      source.connect(analyserPre);

      drawPreCallWave();
    } catch (err) {
      alert("Microphone permission denied. To use this app, please grant microphone permissions.");
      console.warn("Microphone test error:", err);
    }
  }

  function drawPreCallWave() {
    animFramePre = requestAnimationFrame(drawPreCallWave);
    if (!analyserPre) return;

    const canvas = document.getElementById('pre-call-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height;

    const bufferLength = analyserPre.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserPre.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, W, H);
    
    // Draw clean neon wave
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#06B6D4'; // neon cyan
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(6, 182, 212, 0.6)';
    ctx.beginPath();

    const sliceWidth = W / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * H) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(W, H / 2);
    ctx.stroke();
    // Reset shadow properties to avoid impacting other elements
    ctx.shadowBlur = 0;
  }

  function stopPreCallTest() {
    cancelAnimationFrame(animFramePre);
    animFramePre = null;
    if (audioCtxPre) {
      audioCtxPre.close();
      audioCtxPre = null;
    }
    analyserPre = null;
    if (preCallStream) {
      preCallStream.getTracks().forEach(t => t.stop());
      preCallStream = null;
    }
  }

  // ──────────── WebRTC / Call Logic ────────────
  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('online-count', (count) => {
      const el = document.getElementById('online-count');
      if (el) el.textContent = count;
    });

    socket.on('searching', () => {
      showScreen('searching');
      startTipsRotation();
    });

    socket.on('idle', () => {
      showScreen('idle');
      stopTipsRotation();
    });

    socket.on('matched', async ({ initiator, partner }) => {
      stopPreCallTest();
      stopTipsRotation();

      isInitiator = initiator;
      partnerProfile = partner;
      
      // Update UI elements for matched profiles
      showScreen('connected');
      setupCallScreenUI();

      startTimer();

      // Reset controls UI
      isMuted = false;
      isDeafened = false;
      const muteBtn = document.getElementById('btn-mute');
      const deafBtn = document.getElementById('btn-deafen');
      if (muteBtn) muteBtn.classList.remove('btn-active-red');
      if (deafBtn) deafBtn.classList.remove('btn-active-red');
      
      // Request active local stream if not already present
      const success = await ensureLocalStream();
      if (!success) {
        endCall();
        return;
      }

      if (initiator) {
        await createOffer();
      }
    });

    socket.on('offer', async (data) => {
      await ensurePeer();
      await peerConn.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);
      socket.emit('answer', answer);
    });

    socket.on('answer', async (data) => {
      if (peerConn) {
        await peerConn.setRemoteDescription(new RTCSessionDescription(data));
      }
    });

    socket.on('ice-candidate', async (data) => {
      if (peerConn) {
        try {
          await peerConn.addIceCandidate(new RTCIceCandidate(data));
        } catch (e) {
          // ignore stale candidates
        }
      }
    });

    socket.on('partner-left', () => {
      closePeer();
      stopTimer();
      
      document.getElementById('ended-msg').textContent = 'Your partner skipped or disconnected.';
      
      // Populate Call Stats
      document.getElementById('ended-duration').textContent = formatSeconds(callSeconds);
      
      // Shared interests listing
      const shared = (partnerProfile && partnerProfile.interests) 
        ? partnerProfile.interests.filter(tag => myProfile.interests.includes(tag))
        : [];
      document.getElementById('ended-interests').textContent = shared.length > 0 ? shared.map(s => '#' + s).join(', ') : 'None';
      
      showScreen('ended');
    });

    // Chat Message relay
    socket.on('chat-message', (msg) => {
      appendChatMessage(msg.text, 'partner');
    });
  }

  async function ensureLocalStream() {
    if (localStream) return true;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return true;
    } catch (err) {
      alert("Microphone permission required for calls.");
      return false;
    }
  }

  async function ensurePeer() {
    closePeer();
    peerConn = new RTCPeerConnection(STUN_SERVERS);

    // Feed local audio tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConn.addTrack(track, localStream);
      });
    }

    peerConn.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('ice-candidate', candidate);
    };

    peerConn.ontrack = (event) => {
      const remoteAudio = document.getElementById('remote-audio');
      if (remoteAudio) {
        remoteAudio.srcObject = event.streams[0];
        // Apply deafen state if active
        remoteAudio.volume = isDeafened ? 0 : 1;
        startActiveVisualizer(event.streams[0]);
      }
    };

    peerConn.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(peerConn.connectionState)) {
        closePeer();
      }
    };
  }

  async function createOffer() {
    await ensurePeer();
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    socket.emit('offer', offer);
  }

  function closePeer() {
    if (peerConn) {
      peerConn.close();
      peerConn = null;
    }
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      remoteAudio.srcObject = null;
    }
    stopActiveVisualizer();
  }

  // ──────────── Call Visualizers ────────────
  function startActiveVisualizer(stream) {
    stopActiveVisualizer();
    try {
      audioCtxActive = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtxActive.createMediaStreamSource(stream);
      analyserActive = audioCtxActive.createAnalyser();
      analyserActive.fftSize = 128;
      source.connect(analyserActive);
      drawActiveVisualizer();
    } catch (e) {
      console.warn("Could not start active visualizer:", e);
    }
  }

  function drawActiveVisualizer() {
    animFrameActive = requestAnimationFrame(drawActiveVisualizer);
    if (!analyserActive) return;

    const canvas = document.getElementById('active-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height;

    const bufferLength = analyserActive.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserActive.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, W, H);
    
    // Draw neon glowing frequency bars
    const barWidth = (W / bufferLength) * 1.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const percent = dataArray[i] / 255;
      const barHeight = percent * H * 0.85;

      const hue = 260 + (i / bufferLength) * 60; // Violet to Aqua gradient
      ctx.fillStyle = `hsla(${hue}, 85%, 65%, 0.85)`;
      ctx.shadowBlur = 6;
      ctx.shadowColor = `hsla(${hue}, 85%, 65%, 0.4)`;

      ctx.beginPath();
      ctx.roundRect(x, H - barHeight, barWidth - 2, barHeight, 3);
      ctx.fill();

      x += barWidth;
    }
    ctx.shadowBlur = 0;
  }

  function stopActiveVisualizer() {
    cancelAnimationFrame(animFrameActive);
    animFrameActive = null;
    if (audioCtxActive) {
      audioCtxActive.close();
      audioCtxActive = null;
    }
    analyserActive = null;
    const canvas = document.getElementById('active-visualizer');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ──────────── Setup Call Screen Info ────────────
  function setupCallScreenUI() {
    // Self details
    const meName = document.getElementById('me-name');
    const meAvatar = document.getElementById('me-avatar');
    const meTagsContainer = document.getElementById('me-tags');

    if (meName) meName.textContent = myProfile.nickname || "You";
    if (meAvatar) meAvatar.textContent = myProfile.avatar;
    if (meTagsContainer) {
      meTagsContainer.innerHTML = '';
      myProfile.interests.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'peer-tag';
        span.textContent = '#' + tag;
        meTagsContainer.appendChild(span);
      });
    }

    // Partner details
    const partName = document.getElementById('partner-name');
    const partAvatar = document.getElementById('partner-avatar');
    const partTagsContainer = document.getElementById('partner-tags');

    if (partName) partName.textContent = partnerProfile ? partnerProfile.nickname : "Stranger";
    if (partAvatar) partAvatar.textContent = partnerProfile ? partnerProfile.avatar : "👤";
    if (partTagsContainer) {
      partTagsContainer.innerHTML = '';
      if (partnerProfile && partnerProfile.interests) {
        partnerProfile.interests.forEach(tag => {
          const span = document.createElement('span');
          const isShared = myProfile.interests.includes(tag);
          span.className = 'peer-tag' + (isShared ? ' matched-interest' : '');
          span.textContent = '#' + tag;
          partTagsContainer.appendChild(span);
        });
      }
    }

    // Reset Text Chat Box
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
      chatContainer.innerHTML = '<div class="system-msg">System: You are connected anonymously. Type a message below to start chatting.</div>';
    }
  }

  // ──────────── Text Chat ────────────
  function sendChatMessage(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    
    // Send to partner
    if (socket) {
      socket.emit('chat-message', { text });
    }

    // Append locally
    appendChatMessage(text, 'me');
    input.value = '';
  }

  function appendChatMessage(text, sender) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `chat-msg ${sender}`;
    div.textContent = text;
    container.appendChild(div);

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // ──────────── Search Tips Loop ────────────
  function startTipsRotation() {
    stopTipsRotation();
    rotateTip();
    tipsInterval = setInterval(rotateTip, 4500);
  }

  function rotateTip() {
    const el = document.getElementById('dynamic-tip');
    if (!el) return;
    const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)];
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = `"${randomTip}"`;
      el.style.opacity = '1';
    }, 200);
  }

  function stopTipsRotation() {
    clearInterval(tipsInterval);
    tipsInterval = null;
  }

  // ──────────── Keyboard Listener Hooks ────────────
  function setupKeyListeners() {
    document.addEventListener('keydown', (e) => {
      const activeScreen = document.querySelector('.screen.active');
      if (!activeScreen) return;
      const screenId = activeScreen.id;

      // Ignore shortcuts if the user is typing in a text field!
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') {
        return;
      }

      if (screenId === 'screen-connected') {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          skip();
        } else if (e.key.toLowerCase() === 'm') {
          toggleMute();
        } else if (e.key.toLowerCase() === 'd') {
          toggleDeafen();
        } else if (e.key === 'Escape') {
          endCall();
        }
      }
    });
  }

  // ──────────── Control Button Actions ────────────
  async function findPartner() {
    const inputNick = document.getElementById('input-nickname');
    if (inputNick && inputNick.value.trim()) {
      myProfile.nickname = inputNick.value.trim();
    } else {
      generateNickname();
    }

    const selectLang = document.getElementById('select-lang');
    if (selectLang) {
      myProfile.language = selectLang.value;
    }

    // Ensure mic is active
    const hasMic = await ensureLocalStream();
    if (!hasMic) return;

    connectSocket();
    socket.emit('find-partner', myProfile);
  }

  function cancelSearch() {
    if (socket) socket.emit('end-call');
    showScreen('idle');
  }

  function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });

    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      if (isMuted) {
        muteBtn.classList.add('btn-active-red');
        muteBtn.querySelector('.action-btn-label').textContent = 'Unmute';
      } else {
        muteBtn.classList.remove('btn-active-red');
        muteBtn.querySelector('.action-btn-label').textContent = 'Mute';
      }
    }
  }

  function toggleDeafen() {
    isDeafened = !isDeafened;
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
      remoteAudio.volume = isDeafened ? 0 : 1;
    }

    const deafBtn = document.getElementById('btn-deafen');
    if (deafBtn) {
      if (isDeafened) {
        deafBtn.classList.add('btn-active-red');
        deafBtn.querySelector('.action-btn-label').textContent = 'Undeafen';
      } else {
        deafBtn.classList.remove('btn-active-red');
        deafBtn.querySelector('.action-btn-label').textContent = 'Deafen';
      }
    }
  }

  function skip() {
    closePeer();
    stopTimer();
    if (socket) socket.emit('skip');
    
    // Auto initiate find next
    findPartner();
  }

  function endCall() {
    closePeer();
    stopTimer();
    if (socket) socket.emit('end-call');
    
    // Populate Call Stats
    document.getElementById('ended-duration').textContent = formatSeconds(callSeconds);
    const shared = (partnerProfile && partnerProfile.interests) 
      ? partnerProfile.interests.filter(tag => myProfile.interests.includes(tag))
      : [];
    document.getElementById('ended-interests').textContent = shared.length > 0 ? shared.map(s => '#' + s).join(', ') : 'None';

    document.getElementById('ended-msg').textContent = 'You disconnected the call.';
    showScreen('ended');
  }

  function goHome() {
    showScreen('idle');
  }

  function submitFeedback(isPositive) {
    alert(isPositive ? "Thank you for the upvote! Glad you had a good conversation." : "Report received. We will inspect user flags to ensure matching security.");
    goHome();
  }

  // ──────────── Timer Utilities ────────────
  function startTimer() {
    callSeconds = 0;
    updateTimerUI();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      callSeconds++;
      updateTimerUI();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimerUI() {
    const el = document.getElementById('call-timer');
    if (el) el.textContent = formatSeconds(callSeconds);
  }

  function formatSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Window onload trigger
  window.addEventListener('DOMContentLoaded', init);

  return {
    generateNickname,
    testMicrophone,
    findPartner,
    cancelSearch,
    toggleMute,
    toggleDeafen,
    skip,
    endCall,
    goHome,
    sendChatMessage,
    submitFeedback
  };
})();
