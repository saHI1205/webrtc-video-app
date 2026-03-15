const socket = io();

// DOM
const splashScreen = document.getElementById("splashScreen");
const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");

const roomPill = document.getElementById("roomPill");
const miniLocalVideo = document.getElementById("miniLocalVideo");
const videoGrid = document.getElementById("videoGrid");
const remoteOverlay = document.getElementById("remoteOverlay");
const toast = document.getElementById("toast");
const statusText = document.getElementById("statusText");
const callTimer = document.getElementById("callTimer");
const recBadge = document.getElementById("recBadge");

const mainVideo = document.getElementById("mainVideo");
const mainNameTag = document.getElementById("mainNameTag");
const thumbStrip = document.getElementById("thumbStrip");

const chatBtn = document.getElementById("chatBtn");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");
const leaveBtn = document.getElementById("leaveBtn");
const switchCamBtn = document.getElementById("switchCamBtn");

// Menu / recording / screenshot
const menuBtn = document.getElementById("menuBtn");
const menuDropdown = document.getElementById("menuDropdown");
const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const screenshotBtn = document.getElementById("screenshotBtn");

// Splash screen
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.style.opacity = "0";
      splashScreen.style.transform = "scale(1.03)";
      splashScreen.style.transition = "opacity .55s ease, transform .55s ease";

      setTimeout(() => {
        splashScreen.style.display = "none";
        joinScreen.classList.remove("hidden");
      }, 550);
    } else {
      joinScreen.classList.remove("hidden");
    }
  }, 3200);
});

// State
let myName = "You";
let roomId = "";
let localStream = null;
let currentFacingMode = "user";

const peers = {};
const remoteNames = {};
const pendingCandidates = {};
const remoteStreams = {};
const participants = {};

let mainParticipantId = null;

let timerInterval = null;
let startTimeMs = null;

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;

const rtcConfig = {
  iceServers: [
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "ad2811a6461717db07e01100",
      credential: "ihlYqRkUJDKGx98W",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "ad2811a6461717db07e01100",
      credential: "ihlYqRkUJDKGx98W",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "ad2811a6461717db07e01100",
      credential: "ihlYqRkUJDKGx98W",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "ad2811a6461717db07e01100",
      credential: "ihlYqRkUJDKGx98W",
    },
  ],
  iceCandidatePoolSize: 10
};

const peerConnectionConfig = {
  ...rtcConfig,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require"
};

// UI helpers
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 1800);
}

function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));
}

function addChatMsg(name, message) {
  if (!chatBox) return;

  const div = document.createElement("div");
  div.className = "chatMsg";
  div.innerHTML = `
    <div class="who">${escapeHtml(name)}</div>
    <div class="text">${escapeHtml(message)}</div>
  `;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function updateRecBadge(show) {
  if (!recBadge) return;
  recBadge.classList.toggle("hidden", !show);
}

function logPeerDebug(peerId, label, value) {
  console.log(`[${peerId}] ${label}:`, value);
}

// Timer
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startTimer() {
  if (timerInterval) return;

  startTimeMs = Date.now();
  if (callTimer) callTimer.textContent = "00:00";

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTimeMs) / 1000);
    if (callTimer) callTimer.textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  startTimeMs = null;
  if (callTimer) callTimer.textContent = "00:00";
}

// Participant UI
function participantCount() {
  return Object.keys(participants).length;
}

function ensureMainParticipant() {
  if (!mainParticipantId && participants.local) {
    mainParticipantId = "local";
  }

  if (mainParticipantId && participants[mainParticipantId]) {
    return;
  }

  const ids = Object.keys(participants);
  mainParticipantId = ids.length ? ids[0] : null;
}

function setMainParticipant(id) {
  if (!participants[id]) return;

  mainParticipantId = id;
  renderParticipants();
}

function createThumbTile(id, participant) {
  const tile = document.createElement("div");
  tile.className = "thumbTile";
  tile.dataset.id = id;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.srcObject = participant.stream;

  const tag = document.createElement("div");
  tag.className = "nameTag";
  tag.textContent = participant.name || "Participant";

  tile.appendChild(video);
  tile.appendChild(tag);

  tile.addEventListener("click", () => {
    setMainParticipant(id);
  });

  return tile;
}

function renderParticipants() {
  ensureMainParticipant();

  if (thumbStrip) thumbStrip.innerHTML = "";

  if (!mainParticipantId || !participants[mainParticipantId]) {
    if (mainVideo) mainVideo.srcObject = null;
    if (mainNameTag) mainNameTag.textContent = "You";
    return;
  }

  const mainParticipant = participants[mainParticipantId];

  if (mainVideo && mainVideo.srcObject !== mainParticipant.stream) {
    mainVideo.srcObject = mainParticipant.stream;
  }

  if (mainVideo) mainVideo.muted = !!mainParticipant.isLocal;
  if (mainNameTag) mainNameTag.textContent = mainParticipant.name || "Participant";

  if (mainVideo) {
    mainVideo.play().catch((e) => {
      console.log("Main video play warning:", e);
    });
  }

  Object.keys(participants).forEach((id) => {
    if (id === mainParticipantId || !thumbStrip) return;
    const tile = createThumbTile(id, participants[id]);
    thumbStrip.appendChild(tile);
  });

  updateMeetingState();
}

function updateMeetingState() {
  const count = participantCount();

  if (count <= 1) {
    if (remoteOverlay) remoteOverlay.classList.remove("hidden");
    setStatus("Waiting for participant…");
    stopTimer();
  } else {
    if (remoteOverlay) remoteOverlay.classList.add("hidden");
    setStatus("Connected");
    startTimer();
  }
}

function addOrUpdateParticipant(id, stream, name, isLocal = false) {
  participants[id] = {
    stream,
    name,
    isLocal
  };

  if (!mainParticipantId) {
    mainParticipantId = id;
  }

  renderParticipants();
}

function removeParticipant(id) {
  if (!participants[id]) return;

  delete participants[id];

  if (mainParticipantId === id) {
    const ids = Object.keys(participants);
    mainParticipantId = ids.length ? ids[0] : null;
  }

  renderParticipants();
}

// Media
async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: currentFacingMode },
    audio: true
  });

  if (miniLocalVideo) miniLocalVideo.srcObject = localStream;

  try {
    if (miniLocalVideo) await miniLocalVideo.play();
  } catch (e) {
    console.log("Mini local video autoplay warning:", e);
  }

  addOrUpdateParticipant("local", localStream, myName, true);
}

async function replaceVideoTrackForPeers(newTrack) {
  for (const peerId of Object.keys(peers)) {
    const sender = peers[peerId]
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");

    if (sender) {
      await sender.replaceTrack(newTrack);
    }
  }
}

async function switchCamera() {
  if (!localStream) {
    showToast("Camera not started");
    return;
  }

  try {
    const oldVideoTrack = localStream.getVideoTracks()[0];
    const nextFacingMode = currentFacingMode === "user" ? "environment" : "user";

    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: nextFacingMode } },
      audio: false
    });

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      showToast("No alternate camera found");
      return;
    }

    await replaceVideoTrackForPeers(newVideoTrack);

    localStream.removeTrack(oldVideoTrack);
    oldVideoTrack.stop();
    localStream.addTrack(newVideoTrack);

    if (miniLocalVideo) miniLocalVideo.srcObject = localStream;

    if (participants.local) {
      participants.local.stream = localStream;
    }

    currentFacingMode = nextFacingMode;
    renderParticipants();
    showToast("Camera switched");
  } catch (error) {
    console.log("Switch camera error:", error);
    showToast("Unable to switch camera");
  }
}

// Remote stream attach
function attachRemoteStream(peerId, stream) {
  const name = remoteNames[peerId] || "Remote";
  addOrUpdateParticipant(peerId, stream, name, false);
}

async function flushPendingCandidates(peerId, pc) {
  if (!pendingCandidates[peerId] || !pendingCandidates[peerId].length) return;

  for (const candidate of pendingCandidates[peerId]) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.log("Queued ICE add error:", e);
    }
  }

  delete pendingCandidates[peerId];
}

// Peer
function createPeer(peerId) {
  if (peers[peerId]) return peers[peerId];

  const pc = new RTCPeerConnection(peerConnectionConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", {
        roomId,
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    logPeerDebug(peerId, "ontrack streams", event.streams);

    let stream = event.streams && event.streams[0];

    if (!stream) {
      if (!remoteStreams[peerId]) {
        remoteStreams[peerId] = new MediaStream();
      }
      remoteStreams[peerId].addTrack(event.track);
      stream = remoteStreams[peerId];
    } else {
      remoteStreams[peerId] = stream;
    }

    attachRemoteStream(peerId, stream);
  };

  pc.oniceconnectionstatechange = () => {
    logPeerDebug(peerId, "ICE state", pc.iceConnectionState);

    if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
      if (pc.iceConnectionState === "failed") {
        showToast("Media connection failed");
      }

      if (peers[peerId] && pc.iceConnectionState === "closed") {
        try {
          peers[peerId].close();
        } catch (_) {}
        delete peers[peerId];
        removeParticipant(peerId);
      }
    }
  };

  pc.onconnectionstatechange = () => {
    logPeerDebug(peerId, "Peer state", pc.connectionState);

    if (pc.connectionState === "failed") {
      showToast("Peer connection failed");
    }
  };

  pc.onicegatheringstatechange = () => {
    logPeerDebug(peerId, "ICE gathering", pc.iceGatheringState);
  };

  pc.onsignalingstatechange = () => {
    logPeerDebug(peerId, "Signaling state", pc.signalingState);
  };

  pc.onicecandidateerror = (event) => {
    console.log(`[${peerId}] ICE candidate error:`, event);
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  peers[peerId] = pc;
  return pc;
}

async function makeOffer(peerId) {
  const pc = createPeer(peerId);

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });

  await pc.setLocalDescription(offer);

  socket.emit("webrtc-offer", {
    roomId,
    to: peerId,
    offer,
    name: myName
  });
}

// Recording
function createMixedAudioTrack(streams) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const audioContext = new AudioCtx();
  const destination = audioContext.createMediaStreamDestination();
  let hasAudio = false;

  streams.forEach((stream) => {
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(destination);
    hasAudio = true;
  });

  return hasAudio ? destination.stream.getAudioTracks()[0] : null;
}

async function startRecording() {
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const mixedAudioTrack = createMixedAudioTrack([displayStream, localStream]);

    recordingStream = new MediaStream();

    displayStream.getVideoTracks().forEach((track) => {
      recordingStream.addTrack(track);
    });

    if (mixedAudioTrack) {
      recordingStream.addTrack(mixedAudioTrack);
    }

    recordedChunks = [];

    let mimeType = "video/webm;codecs=vp9,opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm;codecs=vp8,opus";
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm";
    }

    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      downloadBlob(blob, `sns-connect-recording-${Date.now()}.webm`);

      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
      }

      if (displayStream) {
        displayStream.getTracks().forEach((track) => track.stop());
      }

      recordingStream = null;
      mediaRecorder = null;
      recordedChunks = [];

      if (startRecordBtn) startRecordBtn.classList.remove("hidden");
      if (stopRecordBtn) stopRecordBtn.classList.add("hidden");
      updateRecBadge(false);

      showToast("Recording saved");
    };

    const displayVideoTrack = displayStream.getVideoTracks()[0];
    if (displayVideoTrack) {
      displayVideoTrack.onended = () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      };
    }

    mediaRecorder.start(1000);

    if (startRecordBtn) startRecordBtn.classList.add("hidden");
    if (stopRecordBtn) stopRecordBtn.classList.remove("hidden");
    updateRecBadge(true);
    if (menuDropdown) menuDropdown.classList.add("hidden");

    showToast("Recording started");
  } catch (error) {
    console.log("Recording error:", error);
    showToast("Recording cancelled or not allowed");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    showToast("Stopping recording...");
  }
  if (menuDropdown) menuDropdown.classList.add("hidden");
}

function getBestScreenshotVideo() {
  if (mainVideo && mainVideo.videoWidth && mainVideo.videoHeight) {
    return mainVideo;
  }

  return null;
}

function takeScreenshot() {
  try {
    const targetVideo = getBestScreenshotVideo();

    if (!targetVideo) {
      showToast("Video not ready for screenshot");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetVideo.videoWidth;
    canvas.height = targetVideo.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(targetVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        showToast("Screenshot failed");
        return;
      }
      downloadBlob(blob, `sns-connect-screenshot-${Date.now()}.png`);
      showToast("Screenshot saved");
    }, "image/png");

    if (menuDropdown) menuDropdown.classList.add("hidden");
  } catch (error) {
    console.log("Screenshot error:", error);
    showToast("Screenshot failed");
  }
}

// Cleanup
function cleanupAllPeers() {
  for (const id of Object.keys(peers)) {
    try {
      peers[id].close();
    } catch (_) {}
    delete peers[id];
  }

  for (const id of Object.keys(remoteStreams)) {
    delete remoteStreams[id];
  }

  for (const id of Object.keys(remoteNames)) {
    delete remoteNames[id];
  }

  for (const id of Object.keys(pendingCandidates)) {
    delete pendingCandidates[id];
  }

  for (const id of Object.keys(participants)) {
    if (id !== "local") delete participants[id];
  }

  mainParticipantId = "local";
  renderParticipants();
}

function cleanupMedia() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  if (miniLocalVideo) miniLocalVideo.srcObject = null;
  if (mainVideo) mainVideo.srcObject = null;

  for (const id of Object.keys(participants)) {
    delete participants[id];
  }

  mainParticipantId = null;
  renderParticipants();
}

function openChat() {
  if (chatPanel) chatPanel.classList.remove("hidden");
}

function closeChat() {
  if (chatPanel) chatPanel.classList.add("hidden");
}

// Menu
if (menuBtn) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuDropdown) menuDropdown.classList.toggle("hidden");
  });
}

document.addEventListener("click", (e) => {
  if (
    menuDropdown &&
    !menuDropdown.classList.contains("hidden") &&
    !menuDropdown.contains(e.target) &&
    menuBtn &&
    !menuBtn.contains(e.target)
  ) {
    menuDropdown.classList.add("hidden");
  }
});

if (startRecordBtn) startRecordBtn.addEventListener("click", startRecording);
if (stopRecordBtn) stopRecordBtn.addEventListener("click", stopRecording);
if (screenshotBtn) screenshotBtn.addEventListener("click", takeScreenshot);
if (switchCamBtn) switchCamBtn.addEventListener("click", switchCamera);

// Join
joinBtn.addEventListener("click", async () => {
  myName = nameInput.value.trim() || "You";
  roomId = roomInput.value.trim() || "music-room";

  joinScreen.classList.add("hidden");
  meetingScreen.classList.remove("hidden");

  if (roomPill) roomPill.textContent = roomId;
  if (mainNameTag) mainNameTag.textContent = myName;

  setStatus("Connecting…");
  showToast("Joining meeting…");

  try {
    await startMedia();
    socket.emit("join-room", { roomId, name: myName });
    updateMeetingState();
  } catch (e) {
    console.log(e);
    showToast("Camera/Mic permission blocked!");
    setStatus("Permission blocked");

    meetingScreen.classList.add("hidden");
    joinScreen.classList.remove("hidden");
  }
});

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

// Socket events
socket.on("room-users", ({ users }) => {
  for (const u of users) {
    remoteNames[u.socketId] = u.name || "Remote";
  }
});

socket.on("user-joined", async ({ socketId, name }) => {
  remoteNames[socketId] = name || "Remote";
  showToast(`${remoteNames[socketId]} joined`);

  try {
    await makeOffer(socketId);
  } catch (e) {
    console.log("Offer creation error:", e);
  }
});

socket.on("webrtc-offer", async ({ offer, from, name }) => {
  remoteNames[from] = name || "Remote";

  try {
    const pc = createPeer(from);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingCandidates(from, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("webrtc-answer", {
      roomId,
      to: from,
      answer,
      name: myName
    });
  } catch (e) {
    console.log("Offer handling error:", e);
  }
});

socket.on("webrtc-answer", async ({ answer, from }) => {
  const pc = peers[from];
  if (!pc) return;

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingCandidates(from, pc);
  } catch (e) {
    console.log("Answer handling error:", e);
  }
});

socket.on("webrtc-ice-candidate", async ({ candidate, from }) => {
  const pc = peers[from];

  if (!pc || !pc.remoteDescription) {
    if (!pendingCandidates[from]) pendingCandidates[from] = [];
    pendingCandidates[from].push(candidate);
    return;
  }

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.log("ICE add error:", e);
  }
});

socket.on("user-left", ({ socketId }) => {
  const name = remoteNames[socketId] || "Participant";
  showToast(`${name} left`);

  if (peers[socketId]) {
    try {
      peers[socketId].close();
    } catch (_) {}
    delete peers[socketId];
  }

  removeParticipant(socketId);
});

socket.on("user-mic-status", ({ name, muted }) => {
  const personName = name || "Participant";
  showToast(`${personName} ${muted ? "muted" : "unmuted"} microphone`);
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

  socket.emit("chat-message", {
    roomId,
    name: myName,
    message: msg
  });

  chatInput.value = "";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

socket.on("chat-message", ({ name, message }) => {
  addChatMsg(name, message);
});

// Mute
muteBtn.addEventListener("click", () => {
  if (!localStream) return;

  const a = localStream.getAudioTracks()[0];
  if (!a) return;

  a.enabled = !a.enabled;
  const isMuted = !a.enabled;

  muteBtn.querySelector(".ctlIcon").innerHTML = a.enabled
    ? '<i class="fa-solid fa-microphone"></i>'
    : '<i class="fa-solid fa-microphone-slash"></i>';

  showToast(isMuted ? "Muted" : "Unmuted");

  if (roomId) {
    socket.emit("mic-status-change", {
      roomId,
      name: myName,
      muted: isMuted
    });
  }
});

// Camera
camBtn.addEventListener("click", () => {
  if (!localStream) return;

  const v = localStream.getVideoTracks()[0];
  if (!v) return;

  v.enabled = !v.enabled;

  camBtn.querySelector(".ctlIcon").innerHTML = v.enabled
    ? '<i class="fa-solid fa-video"></i>'
    : '<i class="fa-solid fa-video-slash"></i>';

  showToast(v.enabled ? "Video started" : "Video stopped");
});

// Leave
leaveBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  socket.emit("leave-room");

  showToast("You left the meeting");
  cleanupAllPeers();
  cleanupMedia();

  meetingScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  closeChat();

  roomId = "";
  updateRecBadge(false);
  stopTimer();
});

window.addEventListener("beforeunload", () => {
  socket.emit("leave-room");
});
