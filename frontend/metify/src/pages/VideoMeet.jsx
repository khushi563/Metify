import React, { useEffect, useRef, useState } from 'react';
import io from "socket.io-client";
import { Badge, IconButton, TextField, Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import ChatIcon from '@mui/icons-material/Chat';
import styles from "../styles/videoComponent.module.css";
import server from '../enviroment';

const server_url = server;
const connections = {};

const peerConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function VideoMeetComponent() {
  // Refs
  const socketRef = useRef();
  const socketIdRef = useRef();
  const localVideoRefLobby = useRef();
  const localVideoRefCall = useRef();

  // State
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenAvailable, setScreenAvailable] = useState(false);

  const [videos, setVideos] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessages, setNewMessages] = useState(0);
  const [message, setMessage] = useState("");

  const [askUsername, setAskUsername] = useState(true);
  const [username, setUsername] = useState("");

  // --------------------- Initialization ---------------------
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true });
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);
      await getUserMediaStream();
    } catch (e) {
      console.error("Permissions error:", e);
    }
  };

  const getUserMediaStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoEnabled,
        audio: audioEnabled
      });
      window.localStream = stream;
      if (localVideoRefCall.current) localVideoRefCall.current.srcObject = stream;
      if (localVideoRefLobby.current) localVideoRefLobby.current.srcObject = stream;

      // Update tracks for peers
      for (let id in connections) {
        replaceTracks(connections[id], stream);
      }
    } catch (e) {
      console.error("Failed to get user media:", e);
    }
  };

  // --------------------- Socket / Peer Setup ---------------------
  const connectToServer = () => {
    socketRef.current = io.connect(server_url, { secure: false });

    socketRef.current.on('connect', () => {
      socketIdRef.current = socketRef.current.id;
      socketRef.current.emit('join-call', window.location.href);

      socketRef.current.on('chat-message', addMessage);

      socketRef.current.on('user-joined', (id, clients) => {
        clients.forEach((peerId) => setupPeer(peerId));
      });

      socketRef.current.on('user-left', (id) => {
        setVideos(videos => videos.filter(v => v.socketId !== id));
      });

      socketRef.current.on('signal', handleSignal);
    });
  };

  const setupPeer = (peerId) => {
    if (connections[peerId]) return;
    const pc = new RTCPeerConnection(peerConfig);
    connections[peerId] = pc;

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('signal', peerId, JSON.stringify({ ice: event.candidate }));
      }
    };

    // Receive tracks
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setVideos(prev => {
        const exists = prev.find(v => v.socketId === peerId);
        if (exists) {
          return prev.map(v => v.socketId === peerId ? { ...v, stream } : v);
        }
        return [...prev, { socketId: peerId, stream }];
      });
    };

    // Add local tracks
    if (window.localStream) {
      window.localStream.getTracks().forEach(track => pc.addTrack(track, window.localStream));
    }

    // Create offer if new peer
    if (peerId !== socketIdRef.current) {
      pc.createOffer().then(desc => {
        pc.setLocalDescription(desc).then(() => {
          socketRef.current.emit('signal', peerId, JSON.stringify({ sdp: pc.localDescription }));
        });
      });
    }
  };

  const handleSignal = (fromId, message) => {
    const signal = JSON.parse(message);
    const pc = connections[fromId];
    if (!pc) return;

    if (signal.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
        if (signal.sdp.type === "offer") {
          pc.createAnswer().then(desc => {
            pc.setLocalDescription(desc).then(() => {
              socketRef.current.emit('signal', fromId, JSON.stringify({ sdp: pc.localDescription }));
            });
          });
        }
      });
    }
    if (signal.ice) {
      pc.addIceCandidate(new RTCIceCandidate(signal.ice)).catch(console.error);
    }
  };

  // --------------------- Track Management ---------------------
  const replaceTracks = (pc, newStream) => {
    const senders = pc.getSenders();
    const videoTrack = newStream.getVideoTracks()[0];
    const audioTrack = newStream.getAudioTracks()[0];

    senders.forEach(sender => {
      if (sender.track.kind === 'video' && videoTrack) sender.replaceTrack(videoTrack);
      if (sender.track.kind === 'audio' && audioTrack) sender.replaceTrack(audioTrack);
    });
  };

  // --------------------- Screen Share ---------------------
  const toggleScreenShare = async () => {
    if (!screenSharing) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = stream.getVideoTracks()[0];

        screenTrack.onended = () => stopScreenShare();

        // Replace video track in local stream
        const sender = window.localStream.getVideoTracks()[0];
        window.localStream.removeTrack(sender);
        window.localStream.addTrack(screenTrack);

        // Update all peers
        for (let id in connections) {
          const sender = connections[id].getSenders().find(s => s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        }

        if (localVideoRefCall.current) localVideoRefCall.current.srcObject = window.localStream;
        setScreenSharing(true);
      } catch (e) {
        console.log("Screen share cancelled or failed", e);
        setScreenSharing(false);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = async () => {
    const webcamStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: audioEnabled
    });

    const oldVideoTrack = window.localStream.getVideoTracks()[0];
    window.localStream.removeTrack(oldVideoTrack);

    const newVideoTrack = webcamStream.getVideoTracks()[0];
    window.localStream.addTrack(newVideoTrack);

    // Update all peers
    for (let id in connections) {
      const sender = connections[id].getSenders().find(s => s.track.kind === 'video');
      if (sender) sender.replaceTrack(newVideoTrack);
    }

    if (localVideoRefCall.current) localVideoRefCall.current.srcObject = window.localStream;
    setScreenSharing(false);
  };

  // --------------------- Video / Audio Toggle ---------------------
  const toggleVideo = () => {
    const enabled = !videoEnabled;
    setVideoEnabled(enabled);
    if (window.localStream) {
      window.localStream.getVideoTracks().forEach(track => track.enabled = enabled);
    }
  };

  const toggleAudio = () => {
    const enabled = !audioEnabled;
    setAudioEnabled(enabled);
    if (window.localStream) {
      window.localStream.getAudioTracks().forEach(track => track.enabled = enabled);
    }
  };

  // --------------------- Chat ---------------------
  const addMessage = (data, sender, socketIdSender) => {
    setMessages(prev => [...prev, { sender, data }]);
    if (socketIdSender !== socketIdRef.current) setNewMessages(prev => prev + 1);
  };

  const sendMessage = () => {
    if (!message) return;
    socketRef.current.emit('chat-message', message, username);
    setMessage("");
  };

  // --------------------- Call Management ---------------------
  const endCall = () => {
    window.localStream.getTracks().forEach(track => track.stop());
    window.location.href = "/";
  };

  const joinLobby = () => {
    setAskUsername(false);
    connectToServer();
    getUserMediaStream();
  };

  // --------------------- JSX ---------------------
  return (
    <div>
      {askUsername ? (
        <div>
          <h2>Enter Lobby</h2>
          <TextField label="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <Button variant="contained" onClick={joinLobby}>Connect</Button>
          <div>
            <video ref={localVideoRefLobby} autoPlay muted></video>
          </div>
        </div>
      ) : (
        <div className={styles.meetVideoContainer}>
          {/* Chat */}
          <div className={styles.chatRoom}>
            <h1>Chat</h1>
            <div className={styles.chattingDisplay}>
              {messages.length ? messages.map((m, i) => (
                <div key={i}>
                  <b>{m.sender}</b>: {m.data}
                </div>
              )) : <p>No messages</p>}
            </div>
            <div className={styles.chattingArea}>
              <TextField value={message} onChange={e => setMessage(e.target.value)} label="Type message" />
              <Button variant="contained" onClick={sendMessage}>Send</Button>
            </div>
          </div>

          {/* Controls */}
          <div className={styles.buttonContainers}>
            <IconButton onClick={toggleVideo} style={{ color: "white" }}>
              {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
            <IconButton onClick={endCall} style={{ color: "red" }}>
              <CallEndIcon />
            </IconButton>
            <IconButton onClick={toggleAudio} style={{ color: "white" }}>
              {audioEnabled ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            {screenAvailable && (
              <IconButton onClick={toggleScreenShare} style={{ color: "white" }}>
                {screenSharing ? <StopScreenShareIcon /> : <ScreenShareIcon />}
              </IconButton>
            )}
            <Badge badgeContent={newMessages} color="secondary">
              <IconButton style={{ color: "white" }}>
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>

          {/* Videos */}
          <video ref={localVideoRefCall} autoPlay muted className={styles.meetUserVideo}></video>
          <div className={styles.conferenceView}>
            {videos.map(v => (
              <video
                key={v.socketId}
                ref={ref => ref && (ref.srcObject = v.stream)}
                autoPlay
                playsInline
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
