const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Ensure 'uploads' directory exists on startup so Multer never crashes
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

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

// API Route to handle movie file uploads and enforce HTTPS protocol behind proxies
app.post('/upload-movie', upload.single('movie'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Force https if behind a proxy like Render to prevent mixed-content issues
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
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

    // Join a specific room
    socket.on('join-room', (roomId, userId, username) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId);
        console.log(`User ${username} joined room: ${roomId}`);
    });

    // Listen for 'share-movie' from frontend and broadcast 'sync-video-source'
    socket.on('share-movie', (data) => {
        const targetRoom = data.roomId;
        const url = data.videoUrl || data;
        if (targetRoom && url) {
            socket.to(targetRoom).emit('sync-video-source', url);
        }
    });

    // Synchronize play, pause, and seek actions across clients
    socket.on('media-state-change', (data) => {
        if (data.roomId) {
            socket.to(data.roomId).emit('sync-media', data);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});