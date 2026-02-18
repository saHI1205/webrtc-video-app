const socket = io();

const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");

const roomPill = document.getElementById("roomPill");
const statusText = document.getElementById("statusText");

const callTimer = document.getElementById("callTimer"); // ✅ timer

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const localNameTag = document.getElementById("localNameTag");
const remoteNameTag = document.getElementById("remoteNameTag");

const remoteOverlay = document.getElementById("remoteOverlay");
const remoteTile = document.getElementById("remoteTile");

const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");
const chatBtn = document.getElementById("chatBtn");
const leaveBtn = document.getElementById("leaveBtn");

const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const toast = document.getElementById("toast");

let localStream = null;
let roomId = null;
let myName = "You";

let peerConnection = null;
let remoteSocketId = null;

// Active speaker detection
let audioCtx = null;
let analyser = null;
let rafId = null;

// ✅ Timer variables
let timerInterval = null;
let startTimeMs = null;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 1800);
}

function setStatus(msg) {
  statusText.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

function addChatMsg(name, message) {
  const div = document.createElement("div");
  div.className = "chatMsg";
  div.innerHTML = `<div class="who">${escapeHtml(name)}</div><div class="text">${escapeHtml(message)}</div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* ✅ Timer helpers */
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function startTimer() {
  stopTimer();
  startTimeMs = Date.now();
  callTimer.textContent = "00:00";

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTimeMs) / 1000);
    callTimer.textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  startTimeMs = null;
  callTimer.textContent = "00:00";
}

async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  try { await localVideo.play(); } catch (_) {}
}

function createPeer(toSocketId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", { roomId, candidate: event.candidate, to: toSocketId });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.play().catch(() => {});
    remoteOverlay.classList.add("hidden");
    setStatus("Connected");
    showToast("Participant connected");

    startRemoteSpeakerGlow(event.streams[0]);

    // ✅ Start timer when remote connects
    startTimer();
  };

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  return pc;
}

async function makeOffer(toSocketId) {
  peerConnection = createPeer(toSocketId);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("webrtc-offer", { roomId, offer, to: toSocketId });
}

async function handleOffer({ offer, from }) {
  remoteSocketId = from;
  peerConnection = createPeer(from);

  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("webrtc-answer", { roomId, answer, to: from });
}

async function handleAnswer({ answer }) {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(answer);
}

async function handleIce({ candidate }) {
  if (!peerConnection) return;
  try { await peerConnection.addIceCandidate(candidate); }
  catch (e) { console.log("ICE add error:", e); }
}

function cleanupCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteSocketId = null;
  remoteVideo.srcObject = null;
  remoteOverlay.classList.remove("hidden");
  remoteTile.classList.remove("activeSpeaker");
  stopRemoteSpeakerGlow();

  // ✅ Stop timer when call ends
  stopTimer();
}

function cleanupMedia() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
}

function openChat() { chatPanel.classList.remove("hidden"); }
function closeChat() { chatPanel.classList.add("hidden"); }

/* Active speaker glow */
function startRemoteSpeakerGlow(remoteStream) {
  stopRemoteSpeakerGlow();

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(remoteStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  const tick = () => {
    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
    const avg = sum / data.length;

    if (avg > 6) remoteTile.classList.add("activeSpeaker");
    else remoteTile.classList.remove("activeSpeaker");

    rafId = requestAnimationFrame(tick);
  };

  tick();
}

function stopRemoteSpeakerGlow() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (audioCtx) {
    audioCtx.close().catch(()=>{});
    audioCtx = null;
  }
  analyser = null;
}

/* Join flow */
joinBtn.addEventListener("click", async () => {
  myName = nameInput.value.trim() || "You";
  roomId = roomInput.value.trim() || "music-room";

  joinScreen.classList.add("hidden");
  meetingScreen.classList.remove("hidden");

  roomPill.textContent = `Room: ${roomId}`;
  localNameTag.textContent = myName;

  setStatus("Connecting…");
  showToast("Joining meeting…");

  try {
    await startMedia();
    socket.emit("join-room", { roomId });
    setStatus("Waiting for participant…");
  } catch (e) {
    showToast("Camera/Mic permission blocked!");
    setStatus("Permission blocked");
    console.log(e);
  }
});

/* Socket events */
socket.on("user-joined", async ({ socketId }) => {
  if (remoteSocketId) return;
  remoteSocketId = socketId;
  setStatus("Connecting…");
  showToast("Participant joined — connecting…");
  await makeOffer(socketId);
});

socket.on("webrtc-offer", async (data) => {
  setStatus("Connecting…");
  showToast("Incoming connection…");
  await handleOffer(data);
});

socket.on("webrtc-answer", async (data) => {
  await handleAnswer(data);
});

socket.on("webrtc-ice-candidate", async (data) => {
  await handleIce(data);
});

socket.on("user-left", ({ socketId }) => {
  if (socketId === remoteSocketId) {
    showToast("Participant left");
    setStatus("Waiting for participant…");
    cleanupCall();
  }
});

/* Chat */
chatBtn.addEventListener("click", () => {
  if (chatPanel.classList.contains("hidden")) openChat();
  else closeChat();
});
chatCloseBtn.addEventListener("click", closeChat);

sendBtn.addEventListener("click", () => {
  if (!roomId) return;
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat-message", { roomId, name: myName, message: msg });
  chatInput.value = "";
});

socket.on("chat-message", ({ name, message }) => {
  addChatMsg(name, message);
});

/* Mute / Video toggle */
muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  const a = localStream.getAudioTracks()[0];
  a.enabled = !a.enabled;

  muteBtn.querySelector(".ctlIcon").innerHTML = a.enabled
    ? '<i class="fa-solid fa-microphone"></i>'
    : '<i class="fa-solid fa-microphone-slash"></i>';

  muteBtn.querySelector(".ctlLabel").textContent = a.enabled ? "Mute" : "Unmute";
  showToast(a.enabled ? "Unmuted" : "Muted");
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  const v = localStream.getVideoTracks()[0];
  v.enabled = !v.enabled;

  camBtn.querySelector(".ctlIcon").innerHTML = v.enabled
    ? '<i class="fa-solid fa-video"></i>'
    : '<i class="fa-solid fa-video-slash"></i>';

  camBtn.querySelector(".ctlLabel").textContent = v.enabled ? "Stop Video" : "Start Video";
  showToast(v.enabled ? "Video started" : "Video stopped");
});

/* Leave */
leaveBtn.addEventListener("click", () => {
  showToast("You left the meeting");
  cleanupCall();
  cleanupMedia();
  stopTimer(); // ✅ ensure timer reset

  meetingScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  closeChat();
});
