import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { apiRouter } from './routes/api';
import { setupSockets } from './sockets/socket';

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Configure CORS to allow Next.js client connection
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Express middleware
// Support parsing JSON and URL encoded bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Support parsing raw binary bodies (used for direct binary music uploads)
app.use('/api/music/upload', express.raw({ type: 'audio/*', limit: '50mb' }));

// Serve static music files
// Files will be located in the root-level 'public' folder
const staticPath = path.join(__dirname, '../../public');
app.use(express.static(staticPath));
console.log(`Serving static files from: ${staticPath}`);

// Register API Routes
app.use('/api', apiRouter);

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', env: process.env.NODE_ENV || 'development' });
});

// Configure Socket.io
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Setup sockets
setupSockets(io);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  ListenMusicVC Server running on port ${PORT}`);
  console.log(`  Client Origin: ${clientOrigin}`);
  console.log(`===============================================`);
});
