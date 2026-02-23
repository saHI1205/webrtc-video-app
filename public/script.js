const socket = io();

// DOM
const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");

const roomPill = document.getElementById("roomPill");
const localTile = document.getElementById("localTile");
const localVideo = document.getElementById("localVideo");
const localNameTag = document.getElementById("localNameTag");
const remoteGrid = document.getElementById("remoteGrid");
const remoteOverlay = document.getElementById("remoteOverlay");
const toast = document.getElementById("toast");
const statusText = document.getElementById("statusText");
const callTimer = document.getElementById("callTimer");

const chatBtn = document.getElementById("chatBtn");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");
const leaveBtn = document.getElementById("leaveBtn");

// State
let myName = "You";
let roomId = "";
let localStream = null;

const peers = {};        // peerId -> RTCPeerConnection
const remoteVideos = {}; // peerId -> video element
const remoteNames = {};  // peerId -> name

let timerInterval = null;
let startTimeMs = null;

// STUN
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// UI helpers
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[m]));
}
function addChatMsg(name, message) {
  const div = document.createElement("div");
  div.className = "chatMsg";
  div.innerHTML = `<div class="who">${escapeHtml(name)}</div><div class="text">${escapeHtml(message)}</div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Timer
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function startTimer() {
  if (timerInterval) return;
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

// Media
async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  try { await localVideo.play(); } catch (_) {}
}

// Remote tiles
function createRemoteTile(peerId, name = "Remote") {
  if (remoteVideos[peerId]) return remoteVideos[peerId];

  const tile = document.createElement("div");
  tile.className = "remoteTile";
  tile.id = `remoteTile-${peerId}`;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  const tag = document.createElement("div");
  tag.className = "nameTag";
  tag.textContent = name;

  tile.appendChild(video);
  tile.appendChild(tag);
  remoteGrid.appendChild(tile);

  remoteVideos[peerId] = video;
  return video;
}
function removeRemoteTile(peerId) {
  const tile = document.getElementById(`remoteTile-${peerId}`);
  if (tile) tile.remove();
  delete remoteVideos[peerId];
  delete remoteNames[peerId];
}

// Peer
function createPeer(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", { roomId, to: peerId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    const name = remoteNames[peerId] || "Remote";
    const vid = createRemoteTile(peerId, name);
    vid.srcObject = event.streams[0];
    vid.play().catch(() => {});
    remoteOverlay.classList.add("hidden");
    setStatus("Connected");
    startTimer();
  };

  // Add local tracks
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  peers[peerId] = pc;
  return pc;
}

async function makeOffer(peerId) {
  // avoid re-offer
  if (peers[peerId]) return;

  const pc = createPeer(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("webrtc-offer", { roomId, to: peerId, offer });
}

// Cleanup
function cleanupAllPeers() {
  for (const id of Object.keys(peers)) {
    try { peers[id].close(); } catch (_) {}
    delete peers[id];
    removeRemoteTile(id);
  }
  remoteOverlay.classList.remove("hidden");
  setStatus("Waiting for participant…");
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

// Join
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
    socket.emit("join-room", { roomId, name: myName });
    setStatus("Waiting for participant…");
  } catch (e) {
    showToast("Camera/Mic permission blocked!");
    setStatus("Permission blocked");
    console.log(e);
  }
});

// Socket events

// ✅ IMPORTANT FIX: New joiner should NOT send offers to all existing users.
// They should just save names and WAIT for offers from existing users.
socket.on("room-users", ({ users }) => {
  for (const u of users) {
    remoteNames[u.socketId] = u.name || "Remote";
  }
});

// Existing users make offer to the new user
socket.on("user-joined", async ({ socketId, name }) => {
  remoteNames[socketId] = name || "Remote";
  showToast(`${remoteNames[socketId]} joined`);
  await makeOffer(socketId);
});

// Incoming offer -> answer
socket.on("webrtc-offer", async ({ offer, from, name }) => {
  remoteNames[from] = name || "Remote";
  const pc = peers[from] || createPeer(from);

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("webrtc-answer", { roomId, to: from, answer });
});

// Incoming answer
socket.on("webrtc-answer", async ({ answer, from }) => {
  const pc = peers[from];
  if (!pc) return;
  await pc.setRemoteDescription(answer);
});

// ICE
socket.on("webrtc-ice-candidate", async ({ candidate, from }) => {
  const pc = peers[from];
  if (!pc) return;
  try { await pc.addIceCandidate(candidate); }
  catch (e) { console.log("ICE add error:", e); }
});

// User left
socket.on("user-left", ({ socketId }) => {
  const name = remoteNames[socketId] || "Participant";
  showToast(`${name} left`);

  if (peers[socketId]) {
    try { peers[socketId].close(); } catch (_) {}
    delete peers[socketId];
  }
  removeRemoteTile(socketId);

  if (Object.keys(peers).length === 0) {
    remoteOverlay.classList.remove("hidden");
    setStatus("Waiting for participant…");
    stopTimer();
  }
});

// Chat
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
socket.on("chat-message", ({ name, message }) => addChatMsg(name, message));

// Mute / cam
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

// ✅ Proper leave
leaveBtn.addEventListener("click", () => {
  socket.emit("leave-room"); // tell server + other users

  showToast("You left the meeting");
  cleanupAllPeers();
  cleanupMedia();
  meetingScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  closeChat();
});