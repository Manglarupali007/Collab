require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');

// ===== IMPORT DATABASE =====
const connectDB = require('./config/database');  // ✅ SIRF EK BAAR
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
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

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
connectDB();  // ✅ SIRF EK BAAR CALL

// ===== IN-MEMORY CACHE =====
const activeRooms = new Map();

// ===== SOCKET AUTH =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// ===== AUTH ROUTES =====

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username and password (min 6 chars) required' });
    }
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    const user = new User({ username: username.trim(), password });
    await user.save();
    
    res.json({ success: true, message: 'User registered successfully!' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    user.lastLogin = new Date();
    user.isOnline = true;
    await user.save();
    
    const token = jwt.sign(
      { username: user.username, userId: user._id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET USER PROFILE
app.get('/api/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      createdAt: user.createdAt,
      isOnline: user.isOnline
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// UPDATE USER PROFILE
app.put('/api/user/:username', async (req, res) => {
  try {
    const { avatar, bio } = req.body;
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (avatar !== undefined) user.avatar = avatar;
    if (bio !== undefined) user.bio = bio;
    await user.save();
    
    res.json({
      success: true,
      user: { username: user.username, avatar: user.avatar, bio: user.bio }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== SOCKET EVENTS =====

io.on('connection', (socket) => {
  console.log(`📡 ${socket.username} connected`);
  
  // JOIN ROOM
  socket.on('join-room', async ({ roomId, password }) => {
    try {
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
    } catch (err) {
      console.error('Join room error:', err);
      socket.emit('error', 'Failed to join room');
    }
  });
  
  // SEND MESSAGE
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
    } catch (err) {
      console.error('Send message error:', err);
    }
  });
  
  // UPDATE STATUS
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
    } catch (err) {
      console.error('Update status error:', err);
    }
  });
  
  // TYPING
  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-typing', { username });
  });
  
  socket.on('stop-typing', ({ roomId }) => {
    socket.to(roomId).emit('user-stop-typing', { userId: socket.id });
  });
  
  // REPLY
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
    } catch (err) {
      console.error('Reply error:', err);
    }
  });
  
  // SHARE FILE
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
    } catch (err) {
      console.error('File share error:', err);
    }
  });
  
  // EDIT MESSAGE
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
    } catch (err) {
      console.error('Edit message error:', err);
    }
  });
  
  // ADD REACTION
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
    } catch (err) {
      console.error('Add reaction error:', err);
    }
  });
  
  // PIN MESSAGE
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
    } catch (err) {
      console.error('Pin message error:', err);
    }
  });
  
  // CREATE TASK
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
    } catch (err) {
      console.error('Create task error:', err);
    }
  });
  
  // UPDATE TASK STATUS
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
    } catch (err) {
      console.error('Update task status error:', err);
    }
  });
  
  // DELETE MESSAGE
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
    } catch (err) {
      console.error('Delete message error:', err);
    }
  });
  
  // KICK USER
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
    } catch (err) {
      console.error('Kick user error:', err);
    }
  });
  
  // DISCONNECT
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
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  });
});

// Add these routes in server.js

// ===== CREATE GROUP CHAT =====
app.post('/api/rooms/create-group', async (req, res) => {
  try {
    const { roomName, createdBy, members } = req.body;
    
    if (!roomName || !createdBy) {
      return res.status(400).json({ error: 'Room name and creator required' });
    }
    
    const roomId = Math.random().toString(36).substr(2, 8);
    
    const room = new Room({
      roomId,
      roomName,
      roomType: 'group',
      createdBy,
      groupAdmins: [createdBy],
      users: [{
        username: createdBy,
        role: 'ADMIN',
        status: 'online'
      }]
    });
    
    // Add members
    if (members && members.length > 0) {
      members.forEach(member => {
        if (member !== createdBy) {
          room.users.push({
            username: member,
            role: 'MEMBER',
            status: 'offline'
          });
        }
      });
    }
    
    await room.save();
    
    res.json({
      success: true,
      roomId,
      roomName,
      message: 'Group created successfully!'
    });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// ===== ADD MEMBER TO GROUP =====
app.post('/api/rooms/add-member', async (req, res) => {
  try {
    const { roomId, username, adminUsername } = req.body;
    
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is admin
    if (!room.groupAdmins.includes(adminUsername)) {
      return res.status(403).json({ error: 'Only admins can add members' });
    }
    
    // Check if user already in group
    const existing = room.users.find(u => u.username === username);
    if (existing) {
      return res.status(400).json({ error: 'User already in group' });
    }
    
    room.users.push({
      username,
      role: 'MEMBER',
      status: 'offline'
    });
    
    await room.save();
    
    res.json({
      success: true,
      message: `${username} added to group!`
    });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ===== REMOVE MEMBER FROM GROUP =====
app.post('/api/rooms/remove-member', async (req, res) => {
  try {
    const { roomId, username, adminUsername } = req.body;
    
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is admin
    if (!room.groupAdmins.includes(adminUsername)) {
      return res.status(403).json({ error: 'Only admins can remove members' });
    }
    
    // Cannot remove creator
    if (username === room.createdBy) {
      return res.status(400).json({ error: 'Cannot remove group creator' });
    }
    
    room.users = room.users.filter(u => u.username !== username);
    await room.save();
    
    res.json({
      success: true,
      message: `${username} removed from group!`
    });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ===== PROMOTE TO ADMIN =====
app.post('/api/rooms/promote-admin', async (req, res) => {
  try {
    const { roomId, username, adminUsername } = req.body;
    
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is admin
    if (!room.groupAdmins.includes(adminUsername)) {
      return res.status(403).json({ error: 'Only admins can promote' });
    }
    
    // Update user role
    const user = room.users.find(u => u.username === username);
    if (user) {
      user.role = 'ADMIN';
    }
    
    // Add to group admins
    if (!room.groupAdmins.includes(username)) {
      room.groupAdmins.push(username);
    }
    
    await room.save();
    
    res.json({
      success: true,
      message: `${username} promoted to admin!`
    });
  } catch (err) {
    console.error('Promote admin error:', err);
    res.status(500).json({ error: 'Failed to promote admin' });
  }
});

// ===== GENERATE INVITE LINK =====
app.post('/api/rooms/generate-invite', async (req, res) => {
  try {
    const { roomId, createdBy } = req.body;
    
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const inviteCode = Math.random().toString(36).substr(2, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days valid
    
    const inviteLink = {
      code: inviteCode,
      expiresAt,
      maxUses: 10,
      uses: 0,
      createdBy
    };
    
    room.inviteLinks = room.inviteLinks || [];
    room.inviteLinks.push(inviteLink);
    await room.save();
    
    res.json({
      success: true,
      inviteLink: `${process.env.FRONTEND_URL}/join/${roomId}?code=${inviteCode}`,
      code: inviteCode,
      expiresAt
    });
  } catch (err) {
    console.error('Generate invite error:', err);
    res.status(500).json({ error: 'Failed to generate invite' });
  }
});

// ===== JOIN VIA INVITE LINK =====
app.post('/api/rooms/join-invite', async (req, res) => {
  try {
    const { roomId, code, username } = req.body;
    
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const invite = room.inviteLinks?.find(i => i.code === code);
    if (!invite) {
      return res.status(400).json({ error: 'Invalid invite link' });
    }
    
    if (new Date() > invite.expiresAt) {
      return res.status(400).json({ error: 'Invite link expired' });
    }
    
    if (invite.uses >= invite.maxUses) {
      return res.status(400).json({ error: 'Invite link max uses reached' });
    }
    
    // Add user to group
    const existing = room.users.find(u => u.username === username);
    if (!existing) {
      room.users.push({
        username,
        role: 'MEMBER',
        status: 'offline'
      });
    }
    
    invite.uses += 1;
    await room.save();
    
    res.json({
      success: true,
      message: 'Joined group successfully!'
    });
  } catch (err) {
    console.error('Join invite error:', err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});