require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for image sharing
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB buffer for file transfers
});

// Data store in memory (without database)
const rooms = new Map();
const users = new Map(); // username -> { password, id }

// Background task to send scheduled messages
cron.schedule('* * * * *', () => {
  const now = new Date();
  rooms.forEach((room, roomId) => {
    if (room.scheduledMessages) {
      room.scheduledMessages = room.scheduledMessages.filter(msg => {
        const scheduledTime = new Date(msg.scheduledTime);
        if (scheduledTime <= now) {
          const messageData = { ...msg, id: `sched-${Date.now()}`, scheduledTime: null };
          room.messages.push(messageData);
          io.to(roomId).emit('receive-message', messageData);
          return false;
        }
        return true;
      });
    }
  });
});

// Auth Middleware for Sockets
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    next();
  } catch (err) {
    console.error("Socket Auth Failed:", err.message);
    const error = new Error(err.name === 'TokenExpiredError' ? 'jwt expired' : 'Authentication error');
    next(error);
  }
});

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || username.trim() === "" || password.length < 6) {
      return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
    }
    if (users.has(username)) return res.status(400).json({ error: 'User exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    users.set(username, { password: hashedPassword, id: Date.now().toString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = users.get(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

io.on('connection', (socket) => {
  console.log(`📡 Socket established: ${socket.username} (${socket.id})`);
  
  socket.on('join-room', ({ roomId, password }) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        password: password, // Store the password for the room
        messages: [],
        pinnedMessages: [],
        tasks: [],
        auditLogs: [],
        scheduledMessages: []
      });
    }
    
    const room = rooms.get(roomId);

    // Security Check: Verify password
    if (room.password && room.password !== password) {
      socket.emit('error', 'Invalid room password');
      return;
    }

    socket.join(roomId);
    
    // RBAC: First person is ADMIN, others are MEMBER by default
    const role = room.users.size === 0 ? 'ADMIN' : 'MEMBER';
    room.users.set(socket.id, { username: socket.username, id: socket.id, role, status: 'online' });
    
    // Send chat history to the newly joined user
    socket.emit('message-history', room.messages);
    socket.emit('pinned-history', room.pinnedMessages);

    io.to(roomId).emit('user-joined', {
      users: Array.from(room.users.values()),
      userId: socket.id
    });
    
    console.log(`👤 ${socket.username} joined room: ${roomId}`);
  });
  
  socket.on('update-status', ({ roomId, status }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      room.users.get(socket.id).status = status;
      io.to(roomId).emit('user-joined', { users: Array.from(room.users.values()), userId: null });
    }
  });

  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-typing', { username });
  });

  socket.on('stop-typing', ({ roomId }) => {
    socket.to(roomId).emit('user-stop-typing', { userId: socket.id });
  });
  
  socket.on('send-message', ({ roomId, username, text, image, poll, time, id }) => {
    const room = rooms.get(roomId);
    if (room) {
      const messageData = { 
        id: id || (Date.now() + Math.random().toString(36).substr(2, 9)), 
        username, 
        text, 
        image, // New: support for base64 images
        poll,
        reactions: {}, 
        time 
      };
      room.messages.push(messageData);
      socket.to(roomId).emit('receive-message', messageData);
    }
  });

  socket.on('add-reaction', ({ roomId, messageId, emoji }) => {
    const room = rooms.get(roomId);
    if (room) {
      const msg = room.messages.find(m => m.id === messageId);
      if (msg) {
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
        io.to(roomId).emit('update-reactions', { messageId, reactions: msg.reactions });
      }
    }
  });

  socket.on('vote', ({ roomId, messageId, optionIndex }) => {
    const room = rooms.get(roomId);
    if (room) {
      const pollMsg = room.messages.find(m => m.id === messageId);
      if (pollMsg && pollMsg.poll) {
        pollMsg.poll.options[optionIndex].votes += 1;
        // Broadcast updated poll to everyone
        io.to(roomId).emit('update-poll', { messageId, poll: pollMsg.poll });
      }
    }
  });

  socket.on('schedule-message', ({ roomId, msgData }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.scheduledMessages.push(msgData);
      socket.emit('notification', 'Message scheduled successfully');
    }
  });

  socket.on('create-task', ({ roomId, task }) => {
    const room = rooms.get(roomId);
    if (room) {
      const newTask = { ...task, id: Date.now(), status: 'todo' };
      room.tasks.push(newTask);
      io.to(roomId).emit('task-updated', room.tasks);
    }
  });

  socket.on('update-task-status', ({ roomId, taskId, newStatus }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.tasks = room.tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
      io.to(roomId).emit('task-updated', room.tasks);
    }
  });

  // WebRTC Signaling for Video Calls
  socket.on('call-request', ({ roomId, signal, from }) => {
    socket.to(roomId).emit('incoming-call', { signal, from });
  });

  socket.on('accept-call', ({ roomId, signal }) => {
    socket.to(roomId).emit('call-accepted', signal);
  });

  socket.on('pin-message', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    const user = room?.users.get(socket.id);
    if (room && (user.role === 'ADMIN' || user.role === 'MANAGER')) {
      const message = room.messages.find(m => m.id === messageId);
      if (message && !room.pinnedMessages.find(m => m.id === messageId)) {
        room.pinnedMessages.push(message);
        io.to(roomId).emit('pinned-history', room.pinnedMessages);
      }
    }
  });

  socket.on('delete-message', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    if (room) {
      const message = room.messages.find(msg => msg.id === messageId);
      const user = room.users.get(socket.id);
      
      // RBAC Authorization: Author, Admin, or Manager can delete
      const canDelete = message && (
        message.username === socket.username || 
        user.role === 'ADMIN' || 
        user.role === 'MANAGER'
      );

      if (canDelete) {
        // Filter out the message from history
        room.messages = room.messages.filter(msg => msg.id !== messageId);
        room.pinnedMessages = room.pinnedMessages.filter(msg => msg.id !== messageId);
        // Notify everyone in the room to remove it from their UI
        io.to(roomId).emit('message-deleted', messageId);
        io.to(roomId).emit('pinned-history', room.pinnedMessages);
      } else {
        socket.emit('error', 'Unauthorized to delete this message');
      }
    }
  });
  
  socket.on('kick-user', ({ roomId, userIdToKick }) => {
    const room = rooms.get(roomId);
    const requester = room?.users.get(socket.id);
    // RBAC: Only ADMIN or MANAGER can kick
    if (room && (requester.role === 'ADMIN' || requester.role === 'MANAGER')) {
      const userToKick = io.sockets.sockets.get(userIdToKick);
      if (userToKick) {
        userToKick.emit('kicked');
        userToKick.leave(roomId);
        const userData = room.users.get(userIdToKick);
        room.users.delete(userIdToKick);
        // Notify others
        io.to(roomId).emit('user-left', { userId: userIdToKick, username: userData?.username });
        // Refresh user list for everyone without triggering a "joined" message
        io.to(roomId).emit('user-joined', { users: Array.from(room.users.values()), userId: null });
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userData = room.users.get(socket.id);
        room.users.delete(socket.id);
        io.to(roomId).emit('user-left', { userId: socket.id, username: userData?.username });
        
        if (room.users.size === 0) {
          rooms.delete(roomId);
        } else if (userData?.role === 'ADMIN' && room.users.size > 0) {
          // Promote next user to ADMIN if current admin leaves
          const nextAdminId = room.users.keys().next().value;
          const nextAdmin = room.users.get(nextAdminId);
          if (nextAdmin) nextAdmin.role = 'ADMIN';
          io.to(roomId).emit('user-joined', { users: Array.from(room.users.values()), userId: null });
        }
        break;
      }
    }
    console.log(`🔌 ${socket.username} disconnected`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});