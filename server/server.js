const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded movie files statically so clients can stream them
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure multer storage for saving uploaded movie files
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// API Route to handle movie file uploads from Person A
app.post('/upload-movie', upload.single('movie'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Dynamically detect http/https and the correct host (Render vs Localhost)
    const protocol = req.protocol;
    const host = req.get('host');
    const videoUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    res.json({ videoUrl });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a specific room and handle real-time sync events
    socket.on('join-room', (roomId, userId, username) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId);

        // --- FIXED: Listen for 'share-movie' from frontend and broadcast 'sync-video-source' ---
        socket.on('share-movie', (data) => {
            // data can be an object containing videoUrl (or { roomId, videoUrl })
            const url = data.videoUrl || data;
            socket.to(roomId).emit('sync-video-source', url);
        });

        // Synchronize play, pause, and seek actions across clients
        socket.on('media-state-change', (data) => {
            socket.to(roomId).emit('sync-media', data);
        });

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', userId);
            console.log(`User disconnected: ${userId}`);
        });
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});