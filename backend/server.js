require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');

// ===== IMPORT DATABASE =====
const connectDB = require('./config/database');
const User = require('./models/User');
const Room = require('./models/Room');

const app = express();

// ===== CORS =====
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://*.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin?.endsWith(".vercel.app")) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_super_secret_key_2024';

// ===== SOCKET.IO =====
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || origin?.endsWith(".vercel.app")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ===== CONNECT DATABASE =====
connectDB();

// ===== IN-MEMORY CACHE =====
const activeRooms = new Map();

// ===== SOCKET AUTH =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log("❌ No token provided");
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    socket.userId = decoded.userId;
    console.log(`✅ Socket authenticated: ${socket.username}`);
    next();
  } catch (err) {
    console.error("❌ Socket Auth Failed:", err.message);
    next(new Error('Authentication error'));
  }
});

// ==========================================
// ===== AUTH ROUTES =====
// ==========================================

// ===== REGISTER =====
app.post('/api/register', async (req, res) => {
  try {
    console.log('📝 Register request:', req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Create user
    const user = new User({
      username: username.trim(),
      password: password
    });
    
    await user.save();
    
    console.log(`✅ User registered: ${username}`);
    res.json({ 
      success: true, 
      message: 'User registered successfully!' 
    });
    
  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== LOGIN =====
app.post('/api/login', async (req, res) => {
  try {
    console.log('🔑 Login request:', req.body);
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password using comparePassword
    const isMatch = await new Promise((resolve, reject) => {
      user.comparePassword(password, (err, isMatch) => {
        if (err) return reject(err);
        resolve(isMatch);
      });
    });
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    user.lastLogin = new Date();
    user.isOnline = true;
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { username: user.username, userId: user._id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log(`✅ User logged in: ${username}`);
    res.json({
      success: true,
      token,
      username: user.username,
      user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== GET USER PROFILE =====
app.get('/api/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      createdAt: user.createdAt,
      isOnline: user.isOnline
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== UPDATE USER PROFILE =====
app.put('/api/user/:username', async (req, res) => {
  try {
    const { avatar, bio } = req.body;
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (avatar !== undefined) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    await user.save();
    
    res.json({
      success: true,
      user: {
        username: user.username,
        avatar: user.avatar,
        bio: user.bio
      }
    });
  } catch (error) {
    console.error('❌ Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// ===== SOCKET EVENTS =====
// ==========================================

io.on('connection', (socket) => {
  console.log(`📡 ${socket.username} connected (${socket.id})`);
  
  // ===== JOIN ROOM =====
  socket.on('join-room', async ({ roomId, password }) => {
    try {
      console.log(`📡 ${socket.username} joining room: ${roomId}`);
      
      let room = await Room.findOne({ roomId });
      
      if (!room) {
        room = new Room({
          roomId,
          password,
          createdBy: socket.username,
          users: [],
          messages: [],
          pinnedMessages: [],
          tasks: [],
          scheduledMessages: []
        });
        await room.save();
        console.log(`🆕 New room created: ${roomId}`);
      }
      
      if (room.password !== password) {
        socket.emit('error', 'Invalid room password');
        return;
      }
      
      socket.join(roomId);
      
      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, {
          users: new Map(),
          messages: room.messages || [],
          pinnedMessages: room.pinnedMessages || [],
          tasks: room.tasks || []
        });
      }
      
      const activeRoom = activeRooms.get(roomId);
      
      // Remove existing user entry
      for (const [id, user] of activeRoom.users) {
        if (user.username === socket.username) {
          activeRoom.users.delete(id);
          break;
        }
      }
      
      const user = await User.findOne({ username: socket.username });
      const role = activeRoom.users.size === 0 ? 'ADMIN' : 'MEMBER';
      
      activeRoom.users.set(socket.id, {
        username: socket.username,
        id: socket.id,
        role,
        status: user?.status || 'online',
        avatar: user?.avatar || null,
        bio: user?.bio || ''
      });
      
      if (user) {
        user.isOnline = true;
        user.status = 'online';
        await user.save();
      }
      
      // Update room in database
      room.users = Array.from(activeRoom.users.values()).map(u => ({
        username: u.username,
        socketId: u.id,
        role: u.role,
        status: u.status,
        avatar: u.avatar,
        bio: u.bio
      }));
      await room.save();
      
      socket.emit('message-history', activeRoom.messages);
      socket.emit('pinned-history', activeRoom.pinnedMessages);
      
      io.to(roomId).emit('user-joined', {
        users: Array.from(activeRoom.users.values()),
        userId: socket.id
      });
      
      console.log(`✅ ${socket.username} joined room: ${roomId}`);
    } catch (error) {
      console.error('❌ Join room error:', error);
      socket.emit('error', 'Failed to join room');
    }
  });
  
  // ===== SEND MESSAGE =====
  socket.on('send-message', async ({ roomId, username, text, image, poll, time, id }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const messageId = id || (Date.now() + Math.random().toString(36).substr(2, 9));
      
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
        createdAt: new Date()
      };
      
      activeRoom.messages.push(messageData);
      
      const room = await Room.findOne({ roomId });
      if (room) {
        room.messages.push(messageData);
        await room.save();
      }
      
      io.to(roomId).emit('receive-message', messageData);
    } catch (error) {
      console.error('❌ Send message error:', error);
    }
  });
  
  // ===== TYPING =====
  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-typing', { username });
  });
  
  socket.on('stop-typing', ({ roomId }) => {
    socket.to(roomId).emit('user-stop-typing', { userId: socket.id });
  });
  
  // ===== UPDATE STATUS =====
  socket.on('update-status', async ({ roomId, status }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (activeRoom?.users.has(socket.id)) {
        activeRoom.users.get(socket.id).status = status;
        
        const user = await User.findOne({ username: socket.username });
        if (user) {
          user.status = status;
          await user.save();
        }
        
        const room = await Room.findOne({ roomId });
        if (room) {
          const userIndex = room.users.findIndex(u => u.username === socket.username);
          if (userIndex !== -1) {
            room.users[userIndex].status = status;
            await room.save();
          }
        }
        
        io.to(roomId).emit('user-joined', {
          users: Array.from(activeRoom.users.values()),
          userId: null
        });
      }
    } catch (error) {
      console.error('❌ Update status error:', error);
    }
  });
  
  // ===== REPLY TO MESSAGE =====
  socket.on('reply-to-message', async ({ roomId, messageId, replyText, username, time }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const originalMsg = activeRoom.messages.find(m => m.id === messageId);
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
          },
          createdAt: new Date()
        };
        activeRoom.messages.push(replyData);
        
        const room = await Room.findOne({ roomId });
        if (room) {
          room.messages.push(replyData);
          await room.save();
        }
        
        io.to(roomId).emit('receive-message', replyData);
      }
    } catch (error) {
      console.error('❌ Reply error:', error);
    }
  });
  
  // ===== SHARE FILE =====
  socket.on('share-file', async ({ roomId, username, fileName, fileData, fileType, fileSize, time }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
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
        createdAt: new Date()
      };
      activeRoom.messages.push(fileMessage);
      
      const room = await Room.findOne({ roomId });
      if (room) {
        room.messages.push(fileMessage);
        await room.save();
      }
      
      io.to(roomId).emit('receive-message', fileMessage);
    } catch (error) {
      console.error('❌ File share error:', error);
    }
  });
  
  // ===== EDIT MESSAGE =====
  socket.on('edit-message', async ({ roomId, messageId, newText }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const msg = activeRoom.messages.find(m => m.id === messageId);
      if (msg && msg.username === socket.username) {
        msg.text = newText;
        msg.edited = true;
        msg.editedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const room = await Room.findOne({ roomId });
        if (room) {
          const dbMsg = room.messages.find(m => m.id === messageId);
          if (dbMsg) {
            dbMsg.text = newText;
            dbMsg.edited = true;
            dbMsg.editedAt = msg.editedAt;
            await room.save();
          }
        }
        
        io.to(roomId).emit('message-edited', { messageId, newText, editedAt: msg.editedAt });
      }
    } catch (error) {
      console.error('❌ Edit message error:', error);
    }
  });
  
  // ===== ADD REACTION =====
  socket.on('add-reaction', async ({ roomId, messageId, emoji }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const msg = activeRoom.messages.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
        
        const room = await Room.findOne({ roomId });
        if (room) {
          const dbMsg = room.messages.find(m => m.id === messageId);
          if (dbMsg) {
            dbMsg.reactions = msg.reactions;
            await room.save();
          }
        }
        
        io.to(roomId).emit('update-reactions', { messageId, reactions: msg.reactions });
      }
    } catch (error) {
      console.error('❌ Add reaction error:', error);
    }
  });
  
  // ===== VOTE =====
  socket.on('vote', async ({ roomId, messageId, optionIndex }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const pollMsg = activeRoom.messages.find(m => m.id === messageId);
      if (pollMsg && pollMsg.poll) {
        pollMsg.poll.options[optionIndex].votes += 1;
        
        const room = await Room.findOne({ roomId });
        if (room) {
          const dbMsg = room.messages.find(m => m.id === messageId);
          if (dbMsg) {
            dbMsg.poll = pollMsg.poll;
            await room.save();
          }
        }
        
        io.to(roomId).emit('update-poll', { messageId, poll: pollMsg.poll });
      }
    } catch (error) {
      console.error('❌ Vote error:', error);
    }
  });
  
  // ===== PIN MESSAGE =====
  socket.on('pin-message', async ({ roomId, messageId }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const user = activeRoom.users.get(socket.id);
      if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
        socket.emit('error', 'You need ADMIN or MANAGER role to pin messages');
        return;
      }
      
      const message = activeRoom.messages.find(m => m.id === messageId);
      if (!message) {
        socket.emit('error', 'Message not found');
        return;
      }
      
      const alreadyPinned = activeRoom.pinnedMessages.find(m => m.id === messageId);
      if (alreadyPinned) {
        socket.emit('notification', 'Message already pinned');
        return;
      }
      
      const pinnedMessage = {
        ...message,
        pinnedAt: new Date().toISOString(),
        pinnedBy: socket.username
      };
      activeRoom.pinnedMessages.push(pinnedMessage);
      
      const room = await Room.findOne({ roomId });
      if (room) {
        room.pinnedMessages.push(pinnedMessage);
        await room.save();
      }
      
      io.to(roomId).emit('pinned-history', activeRoom.pinnedMessages);
      socket.emit('notification', '📌 Message pinned successfully!');
    } catch (error) {
      console.error('❌ Pin message error:', error);
    }
  });
  
  // ===== UNPIN MESSAGE =====
  socket.on('unpin-message', async ({ roomId, messageId }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const user = activeRoom.users.get(socket.id);
      if (!user || (user.role !== 'ADMIN' && user.role !== 'MANAGER')) {
        socket.emit('error', 'Not authorized');
        return;
      }
      
      activeRoom.pinnedMessages = activeRoom.pinnedMessages.filter(m => m.id !== messageId);
      
      const room = await Room.findOne({ roomId });
      if (room) {
        room.pinnedMessages = activeRoom.pinnedMessages;
        await room.save();
      }
      
      io.to(roomId).emit('pinned-history', activeRoom.pinnedMessages);
      socket.emit('notification', '📌 Message unpinned!');
    } catch (error) {
      console.error('❌ Unpin message error:', error);
    }
  });
  
  // ===== CREATE TASK =====
  socket.on('create-task', async ({ roomId, task }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (activeRoom) {
        const newTask = { ...task, id: Date.now(), status: 'todo' };
        activeRoom.tasks.push(newTask);
        
        const room = await Room.findOne({ roomId });
        if (room) {
          room.tasks.push(newTask);
          await room.save();
        }
        
        io.to(roomId).emit('task-updated', activeRoom.tasks);
      }
    } catch (error) {
      console.error('❌ Create task error:', error);
    }
  });
  
  // ===== UPDATE TASK STATUS =====
  socket.on('update-task-status', async ({ roomId, taskId, newStatus }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (activeRoom) {
        activeRoom.tasks = activeRoom.tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
        
        const room = await Room.findOne({ roomId });
        if (room) {
          room.tasks = activeRoom.tasks;
          await room.save();
        }
        
        io.to(roomId).emit('task-updated', activeRoom.tasks);
      }
    } catch (error) {
      console.error('❌ Update task status error:', error);
    }
  });
  
  // ===== DELETE MESSAGE =====
  socket.on('delete-message', async ({ roomId, messageId }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom) return;
      
      const message = activeRoom.messages.find(msg => msg.id === messageId);
      const user = activeRoom.users.get(socket.id);
      
      const canDelete = message && (
        message.username === socket.username ||
        user?.role === 'ADMIN' ||
        user?.role === 'MANAGER'
      );
      
      if (canDelete) {
        activeRoom.messages = activeRoom.messages.filter(msg => msg.id !== messageId);
        activeRoom.pinnedMessages = activeRoom.pinnedMessages.filter(msg => msg.id !== messageId);
        
        const room = await Room.findOne({ roomId });
        if (room) {
          room.messages = activeRoom.messages;
          room.pinnedMessages = activeRoom.pinnedMessages;
          await room.save();
        }
        
        io.to(roomId).emit('message-deleted', messageId);
        io.to(roomId).emit('pinned-history', activeRoom.pinnedMessages);
      } else {
        socket.emit('error', 'Unauthorized to delete this message');
      }
    } catch (error) {
      console.error('❌ Delete message error:', error);
    }
  });
  
  // ===== KICK USER =====
  socket.on('kick-user', async ({ roomId, userIdToKick }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      const requester = activeRoom?.users.get(socket.id);
      
      if (activeRoom && (requester?.role === 'ADMIN' || requester?.role === 'MANAGER')) {
        const userToKick = io.sockets.sockets.get(userIdToKick);
        if (userToKick) {
          userToKick.emit('kicked');
          userToKick.leave(roomId);
          
          const userData = activeRoom.users.get(userIdToKick);
          activeRoom.users.delete(userIdToKick);
          
          const room = await Room.findOne({ roomId });
          if (room) {
            room.users = Array.from(activeRoom.users.values()).map(u => ({
              username: u.username,
              socketId: u.id,
              role: u.role,
              status: u.status,
              avatar: u.avatar,
              bio: u.bio
            }));
            await room.save();
          }
          
          io.to(roomId).emit('user-left', { userId: userIdToKick, username: userData?.username });
          io.to(roomId).emit('user-joined', {
            users: Array.from(activeRoom.users.values()),
            userId: null
          });
        }
      }
    } catch (error) {
      console.error('❌ Kick user error:', error);
    }
  });
  
  // ===== DISCONNECT =====
  socket.on('disconnect', async () => {
    console.log(`🔌 ${socket.username} disconnected`);
    
    try {
      const user = await User.findOne({ username: socket.username });
      if (user) {
        user.isOnline = false;
        user.status = 'offline';
        await user.save();
      }
      
      for (const [roomId, activeRoom] of activeRooms) {
        if (activeRoom.users.has(socket.id)) {
          const userData = activeRoom.users.get(socket.id);
          activeRoom.users.delete(socket.id);
          
          const room = await Room.findOne({ roomId });
          if (room) {
            room.users = Array.from(activeRoom.users.values()).map(u => ({
              username: u.username,
              socketId: u.id,
              role: u.role,
              status: u.status,
              avatar: u.avatar,
              bio: u.bio
            }));
            await room.save();
          }
          
          io.to(roomId).emit('user-left', { userId: socket.id, username: userData?.username });
          
          if (activeRoom.users.size === 0) {
            activeRooms.delete(roomId);
          } else if (userData?.role === 'ADMIN' && activeRoom.users.size > 0) {
            const nextAdminId = activeRoom.users.keys().next().value;
            const nextAdmin = activeRoom.users.get(nextAdminId);
            if (nextAdmin) nextAdmin.role = 'ADMIN';
            
            if (room) {
              room.users = Array.from(activeRoom.users.values()).map(u => ({
                username: u.username,
                socketId: u.id,
                role: u.role,
                status: u.status,
                avatar: u.avatar,
                bio: u.bio
              }));
              await room.save();
            }
            
            io.to(roomId).emit('user-joined', {
              users: Array.from(activeRoom.users.values()),
              userId: null
            });
          }
          break;
        }
      }
    } catch (error) {
      console.error('❌ Disconnect error:', error);
    }
  });
});

// ===== SCHEDULED MESSAGES (Cron Job) =====
cron.schedule('* * * * *', async () => {
  const now = new Date();
  for (const [roomId, activeRoom] of activeRooms) {
    if (activeRoom.scheduledMessages && activeRoom.scheduledMessages.length > 0) {
      const toSend = [];
      activeRoom.scheduledMessages = activeRoom.scheduledMessages.filter(msg => {
        const scheduledTime = new Date(msg.scheduledTime);
        if (scheduledTime <= now) {
          toSend.push(msg);
          return false;
        }
        return true;
      });
      
      if (toSend.length > 0) {
        try {
          const room = await Room.findOne({ roomId });
          if (room) {
            const newMessages = toSend.map(msg => ({
              id: `sched-${Date.now()}`,
              username: msg.username,
              text: msg.text,
              time: msg.time,
              readBy: [],
              readCount: 0,
              edited: false,
              createdAt: new Date()
            }));
            room.messages.push(...newMessages);
            await room.save();
            
            newMessages.forEach(msg => {
              io.to(roomId).emit('receive-message', msg);
            });
          }
        } catch (error) {
          console.error('❌ Scheduled message error:', error);
        }
      }
    }
  }
});

// ===== START SERVER =====
const requestedPort = Number(process.env.PORT) || 5000;

const startServer = (port) => {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} is busy. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    console.error('❌ Server failed to start:', error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📍 http://localhost:${port}`);
  });
};

startServer(requestedPort);