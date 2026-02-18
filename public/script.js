const socket = io("/");
const roomId = "music-room";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let peerConnection;

const servers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(stream => {
  localStream = stream;
  localVideo.srcObject = stream;

  peerConnection = new RTCPeerConnection(servers);

  stream.getTracks().forEach(track => {
    peerConnection.addTrack(track, stream);
  });

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };
});

socket.emit("join-room", roomId);

function sendMessage() {
  const msg = document.getElementById("chatInput").value;
  socket.emit("message", msg);
}

socket.on("createMessage", message => {
  const div = document.createElement("div");
  div.innerText = message;
  document.getElementById("chatBox").append(div);
});

function toggleAudio() {
  localStream.getAudioTracks()[0].enabled =
    !localStream.getAudioTracks()[0].enabled;
}

function toggleVideo() {
  localStream.getVideoTracks()[0].enabled =
    !localStream.getVideoTracks()[0].enabled;
}
