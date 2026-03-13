const socket = io();
// If your frontend and backend are on different domains, use this instead:
// const socket = io("https://YOUR_SERVER_DOMAIN");

// DOM
const splashScreen = document.getElementById("splashScreen");
const joinScreen = document.getElementById("joinScreen");
const meetingScreen = document.getElementById("meetingScreen");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");

const roomPill = document.getElementById("roomPill");
const localVideo = document.getElementById("localVideo");
const miniLocalVideo = document.getElementById("miniLocalVideo");
const localNameTag = document.getElementById("localNameTag");
const videoGrid = document.getElementById("videoGrid");
const videoArea = document.getElementById("videoArea");
const remoteOverlay = document.getElementById("remoteOverlay");
const toast = document.getElementById("toast");
const statusText = document.getElementById("statusText");
const callTimer = document.getElementById("callTimer");
const recBadge = document.getElementById("recBadge");

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
const remoteVideos = {};
const remoteNames = {};
const pendingCandidates = {};

let timerInterval = null;
let startTimeMs = null;

// Recording state
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingPreviewVideo = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:YOUR_TURN_SERVER:3478?transport=udp",
        "turn:YOUR_TURN_SERVER:3478?transport=tcp"
      ],
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    }
  ],
  iceCandidatePoolSize: 10
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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[m]));
}

function addChatMsg(name, message) {
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

// Dynamic layout updater
function updateVideoLayout() {
  const count = videoGrid.children.length;

  videoGrid.classList.remove(
    "layout-1",
    "layout-2",
    "layout-3",
    "layout-4",
    "layout-many"
  );

  if (count === 1) {
    videoGrid.classList.add("layout-1");
  } else if (count === 2) {
    videoGrid.classList.add("layout-2");
  } else if (count === 3) {
    videoGrid.classList.add("layout-3");
  } else if (count === 4) {
    videoGrid.classList.add("layout-4");
  } else {
    videoGrid.classList.add("layout-many");
  }

  if (count <= 1) {
    remoteOverlay.classList.remove("hidden");
    setStatus("Waiting for participant…");
    stopTimer();
  } else {
    remoteOverlay.classList.add("hidden");
    setStatus("Connected");
    startTimer();
  }
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
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: currentFacingMode },
    audio: true
  });

  localVideo.srcObject = localStream;
  if (miniLocalVideo) miniLocalVideo.srcObject = localStream;

  try {
    await localVideo.play();
  } catch (e) {
    console.log("Local video autoplay warning:", e);
  }

  if (miniLocalVideo) {
    try {
      await miniLocalVideo.play();
    } catch (e) {
      console.log("Mini local video autoplay warning:", e);
    }
  }

  updateVideoLayout();
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
    localVideo.srcObject = localStream;
    if (miniLocalVideo) miniLocalVideo.srcObject = localStream;

    currentFacingMode = nextFacingMode;
    showToast("Camera switched");
  } catch (error) {
    console.log("Switch camera error:", error);
    showToast("Unable to switch camera");
  }
}

// Remote tiles
function createRemoteTile(peerId, name = "Remote") {
  if (remoteVideos[peerId]) return remoteVideos[peerId];

  const tile = document.createElement("div");
  tile.className = "videoTile";
  tile.id = `remoteTile-${peerId}`;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;

  const tag = document.createElement("div");
  tag.className = "nameTag";
  tag.textContent = name;

  tile.appendChild(video);
  tile.appendChild(tag);
  videoGrid.appendChild(tile);

  remoteVideos[peerId] = video;
  updateVideoLayout();

  return video;
}

function removeRemoteTile(peerId) {
  const tile = document.getElementById(`remoteTile-${peerId}`);
  if (tile) tile.remove();

  delete remoteVideos[peerId];
  delete remoteNames[peerId];
  delete pendingCandidates[peerId];

  updateVideoLayout();
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

  const pc = new RTCPeerConnection(rtcConfig);

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
    const name = remoteNames[peerId] || "Remote";
    const vid = createRemoteTile(peerId, name);
    vid.srcObject = event.streams[0];

    vid.play().catch((e) => {
      console.log("Remote video play warning:", e);
    });

    updateVideoLayout();
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", peerId, pc.iceConnectionState);

    if (["failed", "disconnected", "closed"].includes(pc.iceConnectionState)) {
      if (peers[peerId]) {
        try {
          peers[peerId].close();
        } catch (_) {}
        delete peers[peerId];
      }

      removeRemoteTile(peerId);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Peer state:", peerId, pc.connectionState);
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

  const offer = await pc.createOffer();
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
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const destination = audioContext.crKe9UDk2eYoMm9CAJhsv2CBGW7CUFSPNhu();
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

    const mixedAudioTrack = createMixedAudioTrack([
      displayStream,
      localStream
    ]);

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

      recordingStream = null;
      mediaRecorder = null;
      recordedChunks = [];
      recordingPreviewVideo = null;

      startRecordBtn.classList.remove("hidden");
      stopRecordBtn.classList.add("hidden");
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

    startRecordBtn.classList.add("hidden");
    stopRecordBtn.classList.remove("hidden");
    updateRecBadge(true);
    menuDropdown.classList.add("hidden");

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
  menuDropdown.classList.add("hidden");
}

function getBestScreenshotVideo() {
  const remoteTileVideo = videoGrid.querySelector('[id^="remoteTile-"] video');
  if (remoteTileVideo && remoteTileVideo.videoWidth && remoteTileVideo.videoHeight) {
    return remoteTileVideo;
  }

  if (localVideo && localVideo.videoWidth && localVideo.videoHeight) {
    return localVideo;
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

    menuDropdown.classList.add("hidden");
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
    removeRemoteTile(id);
  }

  updateVideoLayout();
}

function cleanupMedia() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  if (miniLocalVideo) miniLocalVideo.srcObject = null;
}

function openChat() {
  chatPanel.classList.remove("hidden");
}

function closeChat() {
  chatPanel.classList.add("hidden");
}

// Menu
if (menuBtn) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });
}

document.addEventListener("click", (e) => {
  if (
    menuDropdown &&
    !menuDropdown.classList.contains("hidden") &&
    !menuDropdown.contains(e.target) &&
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

  roomPill.textContent = roomId;
  localNameTag.textContent = myName;

  setStatus("Connecting…");
  showToast("Joining meeting…");

  try {
    await startMedia();
    socket.emit("join-room", { roomId, name: myName });
    updateVideoLayout();
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

  removeRemoteTile(socketId);
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

  muteBtn.querySelector(".ctlIcon").innerHTML = a.enabled
    ? '<i class="fa-solid fa-microphone"></i>'
    : '<i class="fa-solid fa-microphone-slash"></i>';

  showToast(a.enabled ? "Unmuted" : "Muted");
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
});

window.addEventListener("beforeunload", () => {
  socket.emit("leave-room");
});
