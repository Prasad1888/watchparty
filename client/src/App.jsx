import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'peerjs';
import './App.css';

const SOCKET_SERVER_URL = 'https://watch-party-backend-jh2r.onrender.com/';

function App() {
  const [inRoom, setInRoom] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [socket, setSocket] = useState(null);
  const [peers, setPeers] = useState({});
  const [videoSrc, setVideoSrc] = useState(null);

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

    // --- NEW: Listen for shared video source from Person A ---
    socket.on('sync-video-source', (url) => {
      setVideoSrc(url);
    });

    // Listen for play/pause/seek sync events
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
      socket.disconnect();
      if (peerInstance.current) peerInstance.current.destroy();
    };
  }, [inRoom, roomId, username, socket]);

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

  // --- NEW: Upload handler function placed inside App component ---
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

        // Ensure roomId and videoUrl are passed cleanly as an object
        socket.emit('share-movie', { roomId, videoUrl: data.videoUrl });
      }
    } catch (err) {
      console.error('Error uploading movie:', err);
    }
  };

  if (!inRoom) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white w-full">
        <form onSubmit={handleJoinRoom} className="bg-gray-800 p-8 rounded-lg shadow-lg w-96 flex flex-col gap-4 border border-gray-700">
          <h2 className="text-2xl font-bold text-center mb-2 text-indigo-400">Movie Watch Party</h2>
          <input
            type="text"
            placeholder="Your Name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="p-3 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-indigo-500"
            required
          />
          <input
            type="text"
            placeholder="Room ID (e.g., room-123)"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="p-3 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-indigo-500"
            required
          />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 p-3 rounded font-bold transition">
            Join Room
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden w-full">
      <div className="flex-1 flex flex-col justify-center items-center p-4 gap-4">
        <div className="w-full max-w-4xl bg-black aspect-video rounded-lg overflow-hidden relative shadow-2xl flex items-center justify-center border border-gray-800">
          {videoSrc ? (
            <video
              ref={moviePlayerRef}
              src={videoSrc}
              controls
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeek}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3">
              <span className="text-gray-400 text-sm">No movie selected yet</span>
              <label className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded cursor-pointer font-medium text-sm transition">
                Select Movie File from PC
                <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col p-4 gap-4">
        <h3 className="font-semibold text-lg border-b border-gray-800 pb-2">Friends in Room ({roomId})</h3>
        <div className="flex flex-col gap-3 overflow-y-auto flex-1">
          <div className="bg-gray-800 aspect-video rounded flex items-center justify-center relative border border-gray-700 overflow-hidden">
            <video ref={myVideoRef} muted autoPlay playsInline className="w-full h-full object-cover" />
            <span className="absolute bottom-1 left-2 text-xs bg-black/60 px-1.5 py-0.5 rounded text-gray-200">
              {username} (You)
            </span>
          </div>

          {Object.entries(peers).map(([peerId, stream]) => (
            <VideoComponent key={peerId} stream={stream} />
          ))}
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
    <div className="bg-gray-800 aspect-video rounded flex items-center justify-center relative border border-gray-700 overflow-hidden">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <span className="absolute bottom-1 left-2 text-xs bg-black/60 px-1.5 py-0.5 rounded text-gray-200">
        Friend
      </span>
    </div>
  );
}

export default App;