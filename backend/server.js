require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');

const app = express();

// ======================================================
// ✅ CORS UPDATE
// ======================================================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://collab-three-lime.vercel.app",
  "https://collab-git-main-rupali-manglas-projects.vercel.app",
  "https://collab-mfpru4651-rupali-manglas-projects.vercel.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-requested-with",
    ],
  })
);
// ======================================================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

// ======================================================
// ✅ SOCKET.IO CORS UPDATE
// ======================================================
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 1e8,
});
// ======================================================

// Data store
const rooms = new Map();
const users = new Map();

// Scheduled messages
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

// Socket Auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log("❌ No token provided");
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    console.log(`✅ Socket authenticated: ${socket.username}`);
    next();
  } catch (err) {
    console.error("❌ Socket Auth Failed:", err.message);
    if (err.name === 'TokenExpiredError') {
      return next(new Error('Session expired. Please login again.'));
    }
    const error = new Error('Authentication error');
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
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
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
        password: password,
        messages: [],
        pinnedMessages: [],
        tasks: [],
        auditLogs: [],
        scheduledMessages: []
      });
    }
    
    const room = rooms.get(roomId);

    if (room.password && room.password !== password) {
      socket.emit('error', 'Invalid room password');
      return;
    }

    socket.join(roomId);
    
    const role = room.users.size === 0 ? 'ADMIN' : 'MEMBER';
    room.users.set(socket.id, { 
      username: socket.username, 
      id: socket.id, 
      role, 
      status: 'online',
      avatar: null,
      bio: ''
    });
    
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
      const messageId = id || (Date.now() + Math.random().toString(36).substr(2, 9));
      
      const existing = room.messages.find(m => m.id === messageId);
      if (existing) {
        return;
      }
      
      const messageData = { 
        id: messageId,
        username, 
        text, 
        image,
        poll,
        reactions: {}, 
        time,
        readBy: [],
        readCount: 0,
        edited: false,
        replyTo: null
      };
      room.messages.push(messageData);
      io.to(roomId).emit('receive-message', messageData);
    }
  });

  // ========== REPLY TO MESSAGE ==========
  socket.on('reply-to-message', ({ roomId, messageId, replyText, username, time }) => {
    const room = rooms.get(roomId);
    if (room) {
      const originalMsg = room.messages.find(m => m.id === messageId);
      if (originalMsg) {
        const replyData = {
          id: `reply-${Date.now()}`,
          username,
          text: replyText,
          time,
          readBy: [],
          readCount: 0,
          edited: false,
          replyTo: {
            id: originalMsg.id,
            username: originalMsg.username,
            text: originalMsg.text.substring(0, 100) + (originalMsg.text.length > 100 ? '...' : '')
          }
        };
        room.messages.push(replyData);
        io.to(roomId).emit('receive-message', replyData);
      }
    }
  });

  // ========== FILE SHARING ==========
  socket.on('share-file', ({ roomId, username, fileName, fileData, fileType, fileSize, time }) => {
    const room = rooms.get(roomId);
    if (room) {
      const fileMessage = {
        id: `file-${Date.now()}`,
        username,
        text: `📎 ${fileName}`,
        file: {
          name: fileName,
          data: fileData,
          type: fileType,
          size: fileSize
        },
        time,
        reactions: {},
        readBy: [],
        readCount: 0,
        edited: false,
        replyTo: null
      };
      room.messages.push(fileMessage);
      io.to(roomId).emit('receive-message', fileMessage);
    }
  });

  // ========== EDIT MESSAGE ==========
  socket.on('edit-message', ({ roomId, messageId, newText }) => {
    const room = rooms.get(roomId);
    if (room) {
      const msg = room.messages.find(m => m.id === messageId);
      if (msg && msg.username === socket.username) {
        msg.text = newText;
        msg.edited = true;
        msg.editedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.to(roomId).emit('message-edited', { messageId, newText, editedAt: msg.editedAt });
        
        const pinnedMsg = room.pinnedMessages.find(m => m.id === messageId);
        if (pinnedMsg) {
          pinnedMsg.text = newText;
          io.to(roomId).emit('pinned-history', room.pinnedMessages);
        }
      }
    }
  });

  // ========== READ RECEIPTS ==========
  socket.on('message-read', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    if (room) {
      const msg = room.messages.find(m => m.id === messageId);
      if (msg) {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.includes(socket.username)) {
          msg.readBy.push(socket.username);
          msg.readCount = msg.readBy.length;
          io.to(roomId).emit('read-receipt', { 
            messageId, 
            readBy: msg.readBy,
            readCount: msg.readCount
          });
        }
      }
    }
  });

  // ========== UPDATE PROFILE ==========
  socket.on('update-profile', ({ roomId, avatar, bio }) => {
    const room = rooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      const user = room.users.get(socket.id);
      if (avatar !== undefined) user.avatar = avatar;
      if (bio !== undefined) user.bio = bio;
      io.to(roomId).emit('user-joined', { 
        users: Array.from(room.users.values()), 
        userId: null 
      });
    }
  });

  // ========== ADD REACTION ==========
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

  // ========== VOTE ==========
  socket.on('vote', ({ roomId, messageId, optionIndex }) => {
    const room = rooms.get(roomId);
    if (room) {
      const pollMsg = room.messages.find(m => m.id === messageId);
      if (pollMsg && pollMsg.poll) {
        pollMsg.poll.options[optionIndex].votes += 1;
        io.to(roomId).emit('update-poll', { messageId, poll: pollMsg.poll });
      }
    }
  });

  // ========== SCHEDULE MESSAGE ==========
  socket.on('schedule-message', ({ roomId, msgData }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.scheduledMessages.push(msgData);
      socket.emit('notification', 'Message scheduled successfully');
    }
  });

  // ========== CREATE TASK ==========
  socket.on('create-task', ({ roomId, task }) => {
    const room = rooms.get(roomId);
    if (room) {
      const newTask = { ...task, id: Date.now(), status: 'todo' };
      room.tasks.push(newTask);
      io.to(roomId).emit('task-updated', room.tasks);
    }
  });

  // ========== UPDATE TASK STATUS ==========
  socket.on('update-task-status', ({ roomId, taskId, newStatus }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.tasks = room.tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
      io.to(roomId).emit('task-updated', room.tasks);
    }
  });

  // ========== PIN MESSAGE ==========
  socket.on('pin-message', ({ roomId, messageId }) => {
    console.log(`📌 Pin request: room=${roomId}, messageId=${messageId}, user=${socket.username}`);
    
    const room = rooms.get(roomId);
    if (!room) {
      console.log('❌ Room not found');
      socket.emit('error', 'Room not found');
      return;
    }
    
    const user = room.users.get(socket.id);
    if (!user) {
      console.log('❌ User not found in room');
      socket.emit('error', 'User not found');
      return;
    }
    
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
      console.log(`❌ User ${socket.username} (${user.role}) not authorized to pin`);
      socket.emit('error', 'You need ADMIN or MANAGER role to pin messages');
      return;
    }
    
    const message = room.messages.find(m => m.id === messageId);
    if (!message) {
      console.log('❌ Message not found');
      socket.emit('error', 'Message not found');
      return;
    }
    
    const alreadyPinned = room.pinnedMessages.find(m => m.id === messageId);
    if (alreadyPinned) {
      console.log('ℹ️ Message already pinned');
      socket.emit('notification', 'Message already pinned');
      return;
    }
    
    const pinnedMessage = { 
      ...message, 
      pinnedAt: new Date().toISOString(),
      pinnedBy: socket.username
    };
    room.pinnedMessages.push(pinnedMessage);
    console.log(`✅ Message pinned by ${socket.username}. Total pinned: ${room.pinnedMessages.length}`);
    
    io.to(roomId).emit('pinned-history', room.pinnedMessages);
    socket.emit('notification', '📌 Message pinned successfully!');
  });

  // ========== UNPIN MESSAGE ==========
  socket.on('unpin-message', ({ roomId, messageId }) => {
    console.log(`📌 Unpin request: room=${roomId}, messageId=${messageId}`);
    
    const room = rooms.get(roomId);
    if (!room) return;
    
    const user = room.users.get(socket.id);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
      socket.emit('error', 'Not authorized');
      return;
    }
    
    room.pinnedMessages = room.pinnedMessages.filter(m => m.id !== messageId);
    io.to(roomId).emit('pinned-history', room.pinnedMessages);
    socket.emit('notification', '📌 Message unpinned!');
  });

  // ========== DELETE MESSAGE ==========
  socket.on('delete-message', ({ roomId, messageId }) => {
    const room = rooms.get(roomId);
    if (room) {
      const message = room.messages.find(msg => msg.id === messageId);
      const user = room.users.get(socket.id);
      
      const canDelete = message && (
        message.username === socket.username || 
        user.role === 'ADMIN' || 
        user.role === 'MANAGER'
      );

      if (canDelete) {
        room.messages = room.messages.filter(msg => msg.id !== messageId);
        room.pinnedMessages = room.pinnedMessages.filter(msg => msg.id !== messageId);
        io.to(roomId).emit('message-deleted', messageId);
        io.to(roomId).emit('pinned-history', room.pinnedMessages);
      } else {
        socket.emit('error', 'Unauthorized to delete this message');
      }
    }
  });
  
  // ========== KICK USER ==========
  socket.on('kick-user', ({ roomId, userIdToKick }) => {
    const room = rooms.get(roomId);
    const requester = room?.users.get(socket.id);
    if (room && (requester.role === 'ADMIN' || requester.role === 'MANAGER')) {
      const userToKick = io.sockets.sockets.get(userIdToKick);
      if (userToKick) {
        userToKick.emit('kicked');
        userToKick.leave(roomId);
        const userData = room.users.get(userIdToKick);
        room.users.delete(userIdToKick);
        io.to(roomId).emit('user-left', { userId: userIdToKick, username: userData?.username });
        io.to(roomId).emit('user-joined', { users: Array.from(room.users.values()), userId: null });
      }
    }
  });

  // ========== CALL ==========
  socket.on('call-request', ({ roomId, signal, from }) => {
    socket.to(roomId).emit('incoming-call', { signal, from });
  });

  socket.on('accept-call', ({ roomId, signal }) => {
    socket.to(roomId).emit('call-accepted', signal);
  });

  // ========== DISCONNECT ==========
  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        const userData = room.users.get(socket.id);
        room.users.delete(socket.id);
        io.to(roomId).emit('user-left', { userId: socket.id, username: userData?.username });
        
        if (room.users.size === 0) {
          rooms.delete(roomId);
        } else if (userData?.role === 'ADMIN' && room.users.size > 0) {
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