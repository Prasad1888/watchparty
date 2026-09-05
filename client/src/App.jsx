import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'peerjs';
// import './App.css';

const SOCKET_SERVER_URL = 'https://watch-party-backend-jh2r.onrender.com/';

function App() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [socket, setSocket] = useState(null);
  const [peers, setPeers] = useState({});
  const [videoSrc, setVideoSrc] = useState(null);
  const [isMuted, setIsMuted] = useState(false);

  const myVideoRef = useRef(null);
  const peerInstance = useRef(null);
  const activeStream = useRef(null);
  const moviePlayerRef = useRef(null);
  const isSyncing = useRef(false);

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username) {
      const newSocket = io(SOCKET_SERVER_URL);
      setSocket(newSocket);
      setInRoom(true);
    }
  };

  useEffect(() => {
    if (!inRoom || !socket) return;

    const peer = new Peer();
    peerInstance.current = peer;

    peer.on('open', (id) => {
      socket.emit('join-room', roomId, id, username);
    });

    navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
      .then((stream) => {
        activeStream.current = stream;
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
          myVideoRef.current.play().catch(e => console.log(e));
        }

        peer.on('call', (call) => {
          call.answer(stream);
          call.on('stream', (remoteStream) => {
            setPeers((prev) => ({ ...prev, [call.peer]: remoteStream }));
          });
        });

        socket.on('user-connected', (userId) => {
          const call = peer.call(userId, stream);
          call.on('stream', (remoteStream) => {
            setPeers((prev) => ({ ...prev, [userId]: remoteStream }));
          });
        });
      })
      .catch((err) => console.error('Failed to get local stream', err));

    socket.on('user-disconnected', (userId) => {
      setPeers((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
    });

    socket.on('sync-video-source', (url) => {
      setVideoSrc(url);
    });

    socket.on('sync-media', (data) => {
      if (!moviePlayerRef.current) return;
      isSyncing.current = true;

      if (data.type === 'play') {
        moviePlayerRef.current.currentTime = data.currentTime;
        moviePlayerRef.current.play().catch(() => { });
      } else if (data.type === 'pause') {
        moviePlayerRef.current.currentTime = data.currentTime;
        moviePlayerRef.current.pause();
      } else if (data.type === 'seek') {
        moviePlayerRef.current.currentTime = data.currentTime;
      }

      setTimeout(() => {
        isSyncing.current = false;
      }, 300);
    });

    return () => {
      if (activeStream.current) {
        activeStream.current.getTracks().forEach((track) => track.stop());
      }
      socket.off('user-disconnected');
      socket.off('sync-video-source');
      socket.off('sync-media');
      if (peerInstance.current) peerInstance.current.destroy();
    };
  }, [inRoom, roomId, username, socket]);

  const toggleMicrophone = async () => {
    if (!activeStream.current) return;

    const audioTrack = activeStream.current.getAudioTracks()[0];

    if (audioTrack && audioTrack.enabled) {
      audioTrack.stop();
      activeStream.current.removeTrack(audioTrack);
      setIsMuted(true);
    } else {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = newStream.getAudioTracks()[0];

        activeStream.current.addTrack(newAudioTrack);
        setIsMuted(false);

        if (peerInstance.current && peers) {
          Object.values(peerInstance.current.connections).forEach(connectionList => {
            connectionList.forEach(conn => {
              if (conn.peerConnection) {
                const sender = conn.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) {
                  sender.replaceTrack(newAudioTrack);
                }
              }
            });
          });
        }
      } catch (err) {
        console.error('Failed to re-acquire microphone:', err);
      }
    }
  };

  const handlePlay = () => {
    if (isSyncing.current || !socket) return;
    socket.emit('media-state-change', {
      type: 'play',
      currentTime: moviePlayerRef.current.currentTime,
      roomId
    });
  };

  const handlePause = () => {
    if (isSyncing.current || !socket) return;
    socket.emit('media-state-change', {
      type: 'pause',
      currentTime: moviePlayerRef.current.currentTime,
      roomId
    });
  };

  const handleSeek = () => {
    if (isSyncing.current || !socket) return;
    socket.emit('media-state-change', {
      type: 'seek',
      currentTime: moviePlayerRef.current.currentTime,
      roomId
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('movie', file);

    try {
      const response = await fetch('https://watch-party-backend-jh2r.onrender.com/upload-movie', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.videoUrl) {
        setVideoSrc(data.videoUrl);
        socket.emit('share-movie', { roomId, videoUrl: data.videoUrl });
      }
    } catch (err) {
      console.error('Error uploading movie:', err);
    }
  };

  if (!inRoom) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-white w-full p-4">
        <form onSubmit={handleJoinRoom} className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md flex flex-col gap-5">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">Movie Watch Party</h2>
            <p className="text-slate-400 text-sm">Enter your details to join or start a room</p>
          </div>
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Your Name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              required
            />
            <input
              type="text"
              placeholder="Room ID (e.g., room-123)"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              required
            />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white p-3.5 rounded-xl font-semibold shadow-lg shadow-indigo-600/25 transition">
            Join Room
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white w-full overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      {/* Main Content Layout: Desktop (Side-by-Side), Mobile (Stacked) */}
      <div className="flex-1 flex flex-col lg:flex-row p-4 lg:p-6 gap-6 items-center justify-center max-w-[1600px] mx-auto w-full my-auto">

        {/* Left Side: Main Video Player */}
        <div className="flex-1 w-full flex items-center justify-center">
          <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden relative shadow-2xl flex items-center justify-center border border-slate-800/80">
            {videoSrc ? (
              <video
                ref={moviePlayerRef}
                src={videoSrc}
                controls
                onPlay={handlePlay}
                onPause={handlePause}
                onSeeked={handleSeek}
                className="w-full h-full object-contain mx-auto"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 p-8 text-center max-w-md">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-1">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-slate-300 font-medium text-base">No movie selected yet</span>
                <p className="text-slate-500 text-xs leading-relaxed">Upload a video file from your computer to start watching together seamlessly.</p>
                <label className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl cursor-pointer font-semibold text-sm transition shadow-lg shadow-indigo-600/25 mt-2">
                  Select Movie File from PC
                  <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Vertical Stacked Cameras & Room Info (Desktop) / Horizontal Row (Mobile) */}
        <div className="w-full lg:w-80 xl:w-96 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex flex-col gap-4 shadow-xl shrink-0">
          {/* Room Header Info */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-slate-400">Room:</span> <span className="text-indigo-400 font-semibold">{roomId}</span>
            </div>
            <span className="bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full font-medium">{Object.keys(peers).length + 1} online</span>
          </div>

          {/* Vertical Camera Feeds Column */}
          {/* Vertical Camera Feeds Column */}
          <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto max-h-[450px] pb-1 lg:pb-0 scrollbar-thin w-full">
            {/* Local User Video */}
            <div className="bg-slate-950 w-56 sm:w-64 lg:w-full aspect-video rounded-xl flex items-center justify-center relative border border-slate-800 overflow-hidden shadow-md shrink-0 group">
              <video ref={myVideoRef} muted autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
              <span className="absolute bottom-2 left-2 text-xs bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-md text-slate-200 font-medium tracking-wide">
                {username} (You)
              </span>
            </div>

            {/* Remote Peer Videos */}
            {Object.entries(peers).map(([peerId, stream]) => (
              <VideoComponent key={peerId} stream={stream} />
            ))}
          </div>

          {/* Mute/Unmute Mic Toggle Button */}
          <button
            onClick={toggleMicrophone}
            className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 shadow-lg mt-auto ${isMuted
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 shadow-slate-900/50'
              }`}
          >
            {isMuted ? <>Unmute Microphone <span className="text-base">🎤</span></> : <>Mute Microphone <span className="text-base">🔇</span></>}
          </button>
        </div>

      </div>
    </div>
  );
}

function VideoComponent({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="bg-slate-950 w-56 sm:w-64 lg:w-full aspect-video rounded-xl flex items-center justify-center relative border border-slate-800 overflow-hidden shadow-md shrink-0 group">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <span className="absolute bottom-2 left-2 text-xs bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-md text-slate-200 font-medium tracking-wide">
        Friend
      </span>
    </div>
  );
}

export default App;