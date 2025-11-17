// server.js - Main server file for Socket.io chat application

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');
const Message = require('./models/Message');

// Load environment variables early
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/realtime-chat', {
  useNewUrlParser: true, useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('Mongo connect error', err));

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users and typing users in-memory
const users = {};
const typingUsers = {};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining
  // Accept either a string username or an object { username, room } in future
  socket.on('user_join', (payload) => {
    const username = typeof payload === 'string' ? payload : payload?.username;
    users[socket.id] = { username, id: socket.id };
    io.emit('user_list', Object.values(users));
    io.emit('user_joined', { username, id: socket.id });
    console.log(`${username} joined the chat`);
  });

  // Handle chat messages (public/global)
  // messageData expected to be { message, room? }
  socket.on('send_message', async (messageData) => {
    try {
      const text = messageData?.message ?? messageData?.text ?? '';
      const room = messageData?.room ?? 'global';

      const message = {
        room,
        text,
        sender: users[socket.id]?.username || 'Anonymous',
        senderId: socket.id,
        to: null,
        isPrivate: false,
      };

      // Save to MongoDB
      const saved = await Message.create({
        room: message.room,
        text: message.text,
        sender: message.sender,
        senderId: message.senderId,
        to: message.to,
        isPrivate: message.isPrivate,
      });

      // Prepare payload to emit (include DB id and timestamp)
      const payload = {
        id: saved._id,
        sender: saved.sender,
        senderId: saved.senderId,
        message: saved.text,
        room: saved.room,
        isPrivate: saved.isPrivate,
        timestamp: saved.createdAt,
      };

      // Emit to all clients (global or you could use io.in(room).emit for room-scoped)
      io.emit('receive_message', payload);
    } catch (err) {
      console.error('Error saving public message:', err);
    }
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    if (users[socket.id]) {
      const username = users[socket.id].username;

      if (isTyping) {
        typingUsers[socket.id] = username;
      } else {
        delete typingUsers[socket.id];
      }

      io.emit('typing_users', Object.values(typingUsers));
    }
  });

  // Handle private messages
  // payload expected: { to: <socketId>, message: <text> }
  socket.on('private_message', async ({ to, message }) => {
    try {
      const messageData = {
        room: null,
        text: message,
        sender: users[socket.id]?.username || 'Anonymous',
        senderId: socket.id,
        to,
        isPrivate: true,
      };

      // Save to MongoDB
      const saved = await Message.create({
        room: messageData.room,
        text: messageData.text,
        sender: messageData.sender,
        senderId: messageData.senderId,
        to: messageData.to,
        isPrivate: true,
      });

      const payload = {
        id: saved._id,
        sender: saved.sender,
        senderId: saved.senderId,
        to: saved.to,
        message: saved.text,
        isPrivate: saved.isPrivate,
        timestamp: saved.createdAt,
      };

      // Send to recipient and also back to sender
      socket.to(to).emit('private_message', payload);
      socket.emit('private_message', payload);
    } catch (err) {
      console.error('Error saving private message:', err);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { username } = users[socket.id];
      io.emit('user_left', { username, id: socket.id });
      console.log(`${username} left the chat`);
    }

    delete users[socket.id];
    delete typingUsers[socket.id];

    io.emit('user_list', Object.values(users));
    io.emit('typing_users', Object.values(typingUsers));
  });
});

// API routes - read messages from DB
app.get('/api/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const room = req.query.room || 'global';

    const query = room ? { room } : {};
    const docs = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
    // return oldest-first
    res.json(docs.reverse());
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };
