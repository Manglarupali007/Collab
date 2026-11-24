require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');

// ===== IMPORT DATABASE =====
const connectDB = require('./config/database');
const User = require('./models/User');
const Room = require('./models/Room');
const DirectConversation = require('./models/DirectConversation');
const DirectMessage = require('./models/DirectMessage');
const { getMediaType, validateMediaFile } = require('./services/mediaValidation');
const {
  applyMove,
  createInitialGame,
  getWinningMark,
  serializeGame
} = require('./services/ticTacToe');

const app = express();

// ===== CORS =====
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
]);

const checkOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.has(origin)) {
    return callback(null, true);
  }
  return callback(new Error('Not allowed by CORS'));
};

app.use(cors({
  origin: checkOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'unavailable',
    database: databaseConnected ? 'connected' : 'disconnected'
  });
});

const requireDatabase = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database unavailable. Start MongoDB and try again.' });
  }

  next();
};

app.use('/api', requireDatabase);

const server = http.createServer(app);
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_super_secret_key_2024';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production');
}

const authenticateToken = (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ===== SOCKET.IO =====
const io = socketIo(server, {
  cors: {
    origin: checkOrigin,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ===== CONNECT DATABASE =====
connectDB();

// ===== IN-MEMORY CACHE =====
const activeRooms = new Map();
const directConversationRoom = id => `direct:${id}`;
const userSocketRoom = id => `user:${id}`;
const acknowledgeSocketEvent = (acknowledge, payload) => {
  if (typeof acknowledge === 'function') acknowledge(payload);
};
const MAX_DIRECT_MEDIA_SIZE = 20 * 1024 * 1024;
const directMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DIRECT_MEDIA_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    try {
      req.uploadMediaType = getMediaType(file);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  }
});

const serializeDirectMessage = (message, conversationId, readReceipts = []) => {
  const media = message.media;
  const fileId = media?.fileId ? String(media.fileId) : null;
  const reactions = message.reactions instanceof Map
    ? Object.fromEntries(message.reactions)
    : (message.reactions || {});
  const deleted = Boolean(message.deletedAt);
  const readBy = (readReceipts || [])
    .filter(receipt => (
      String(receipt.user) !== String(message.sender)
      && new Date(receipt.lastReadAt) >= new Date(message.createdAt)
    ))
    .map(receipt => String(receipt.user));
  return {
    id: String(message._id),
    senderId: String(message.sender),
    username: message.username,
    text: deleted ? 'This message was deleted' : (message.text || ''),
    reactions,
    media: fileId && !deleted ? {
      fileId,
      fileName: media.fileName,
      mimeType: media.mimeType,
      mediaType: media.mediaType,
      size: media.size,
      url: `/api/conversations/${conversationId}/media/${fileId}`
    } : null,
    replyTo: message.replyTo?.messageId ? {
      messageId: String(message.replyTo.messageId),
      username: message.replyTo.username || '',
      text: message.replyTo.text || ''
    } : null,
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
    readBy,
    createdAt: message.createdAt
  };
};

const serializePinnedMessages = async (conversation, readReceipts = []) => {
  const pinnedMessages = await DirectMessage.find({
    _id: { $in: conversation.pinnedMessages || [] },
    conversation: conversation._id,
    deletedAt: { $exists: false }
  }).sort({ createdAt: -1 }).lean();
  return pinnedMessages.map(message => (
    serializeDirectMessage(message, String(conversation._id), readReceipts)
  ));
};

const publishDirectMessage = (conversation, storedMessage) => {
  const conversationId = String(conversation._id);
  const message = serializeDirectMessage(storedMessage, conversationId);
  io.to(directConversationRoom(conversationId)).emit('direct-message', {
    conversationId,
    message
  });
  conversation.participants.forEach(participantId => {
    io.to(userSocketRoom(participantId)).emit('inbox-message', {
      conversationId,
      message
    });
  });
  return message;
};

const refreshConversationPreview = async conversation => {
  const latest = await DirectMessage.findOne({
    conversation: conversation._id,
    deletedAt: { $exists: false }
  }).sort({ createdAt: -1 }).lean();
  conversation.lastMessage = latest ? {
    sender: latest.sender,
    username: latest.username,
    text: latest.text || mediaPreviewText({
      mediaType: latest.media?.mediaType,
      fileName: latest.media?.fileName
    }),
    createdAt: latest.createdAt
  } : undefined;
  await conversation.save();

  const conversationId = String(conversation._id);
  conversation.participants.forEach(participantId => {
    io.to(userSocketRoom(participantId)).emit('conversation-preview-updated', {
      conversationId,
      lastMessage: conversation.lastMessage || null,
      updatedAt: conversation.updatedAt
    });
  });
};

const findAuthorizedConversation = async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) {
    return res.status(400).json({ error: 'Invalid conversation ID' });
  }

  try {
    const conversation = await DirectConversation.findOne({
      _id: req.params.conversationId,
      participants: req.user.userId
    }).select('_id participants');
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    req.directConversation = conversation;
    next();
  } catch (error) {
    console.error('❌ Media conversation lookup error:', error);
    res.status(500).json({ error: 'Unable to access conversation media' });
  }
};

const parseDirectMediaUpload = (req, res, next) => {
  directMediaUpload.single('media')(req, res, error => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Attachments must be 20 MB or smaller' });
    }
    if (error) {
      return res.status(400).json({ error: error.message || 'Invalid attachment' });
    }
    next();
  });
};

const sanitizeMediaFileName = fileName => path.basename(String(fileName || '').replace(/\\/g, '/'))
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, 180) || 'attachment';

const mediaPreviewText = media => {
  if (media.mediaType === 'image') return '📷 Photo';
  if (media.mediaType === 'video') return '🎥 Video';
  return `📎 ${media.fileName}`;
};

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
    const username = typeof req.body.username === 'string'
      ? req.body.username.trim()
      : '';
    const password = typeof req.body.password === 'string'
      ? req.body.password
      : '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
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
    const user = new User({ username, password });
    
    await user.save();
    
    console.log(`✅ User registered: ${username}`);
    res.json({ 
      success: true, 
      message: 'User registered successfully!' 
    });
    
  } catch (error) {
    console.error('❌ Register error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== LOGIN =====
app.post('/api/login', async (req, res) => {
  try {
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
app.get('/api/user/:username', authenticateToken, async (req, res) => {
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
app.put('/api/user/:username', authenticateToken, async (req, res) => {
  try {
    if (req.user.username !== req.params.username) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

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

// ===== DIRECT MESSAGES =====
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const search = String(req.query.q || '').trim().slice(0, 30);
    const filter = { username: { $ne: req.user.username } };

    if (search) {
      filter.username.$regex = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.username.$options = 'i';
    }

    const users = await User.find(filter)
      .select('username avatar bio isOnline status')
      .sort({ username: 1 })
      .limit(50)
      .lean();

    res.json({ users });
  } catch (error) {
    console.error('❌ User directory error:', error);
    res.status(500).json({ error: 'Unable to load users' });
  }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await DirectConversation.find({
      participants: req.user.userId
    })
      .populate('participants', 'username avatar bio isOnline status')
      .sort({ updatedAt: -1 })
      .lean();

    const userId = String(req.user.userId);
    const serialized = await Promise.all(conversations.map(async conversation => {
      const readReceipt = (conversation.readReceipts || []).find(
        receipt => String(receipt.user) === userId
      );
      const unreadCount = await DirectMessage.countDocuments({
        conversation: conversation._id,
        sender: { $ne: req.user.userId },
        deletedAt: { $exists: false },
        createdAt: { $gt: readReceipt?.lastReadAt || new Date(0) }
      });

      return {
        id: conversation._id,
        updatedAt: conversation.updatedAt,
        otherUser: conversation.participants.find(
          participant => String(participant._id) !== userId
        ),
        lastMessage: conversation.lastMessage || null,
        unreadCount,
        pinnedMessageIds: (conversation.pinnedMessages || []).map(String)
      };
    }));
    res.json({ conversations: serialized });
  } catch (error) {
    console.error('❌ Conversation list error:', error);
    res.status(500).json({ error: 'Unable to load conversations' });
  }
});

app.post('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    if (!username) {
      return res.status(400).json({ error: 'A username is required' });
    }

    if (username.toLowerCase() === req.user.username.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot message yourself' });
    }

    const recipient = await User.findOne({ username }).select('_id username avatar bio isOnline status');
    if (!recipient) {
      return res.status(404).json({ error: 'User not found' });
    }

    const participants = [String(req.user.userId), String(recipient._id)].sort();
    const participantKey = participants.join(':');
    let conversation = await DirectConversation.findOne({ participantKey });

    if (!conversation) {
      try {
        conversation = await DirectConversation.create({
          participants,
          participantKey
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        conversation = await DirectConversation.findOne({ participantKey });
      }
    }

    res.status(200).json({
      id: conversation._id,
      updatedAt: conversation.updatedAt,
      otherUser: recipient,
      lastMessage: conversation.lastMessage || null
    });
  } catch (error) {
    console.error('❌ Conversation create error:', error);
    res.status(500).json({ error: 'Unable to start conversation' });
  }
});

app.post(
  '/api/conversations/:conversationId/media',
  authenticateToken,
  findAuthorizedConversation,
  parseDirectMediaUpload,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Choose an attachment to send' });
    }

    const caption = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (caption.length > 4000) {
      return res.status(400).json({ error: 'Captions must be 4000 characters or fewer' });
    }

    let replyTo;
    if (req.body.replyToId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.replyToId)) {
        return res.status(400).json({ error: 'Invalid replied-to message' });
      }
      const repliedMessage = await DirectMessage.findOne({
        _id: req.body.replyToId,
        conversation: req.directConversation._id,
        deletedAt: { $exists: false }
      }).select('_id username text media');
      if (!repliedMessage) {
        return res.status(404).json({ error: 'Replied-to message not found' });
      }
      replyTo = {
        messageId: repliedMessage._id,
        username: repliedMessage.username,
        text: repliedMessage.text || (repliedMessage.media ? 'Attachment' : '')
      };
    }

    let mediaType;
    try {
      mediaType = validateMediaFile(req.file);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    let fileId;
    let storedMessage;
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'directMedia'
    });

    try {
      const fileName = sanitizeMediaFileName(req.file.originalname);
      const uploadStream = bucket.openUploadStream(fileName, {
        contentType: req.file.mimetype,
        metadata: {
          conversationId: String(req.directConversation._id),
          senderId: String(req.user.userId),
          mediaType
        }
      });
      fileId = uploadStream.id;
      await new Promise((resolve, reject) => {
        uploadStream.once('error', reject);
        uploadStream.once('finish', resolve);
        uploadStream.end(req.file.buffer);
      });

      storedMessage = await DirectMessage.create({
        conversation: req.directConversation._id,
        sender: req.user.userId,
        username: req.user.username,
        text: caption,
        replyTo,
        media: {
          fileId,
          fileName,
          mimeType: req.file.mimetype,
          mediaType,
          size: req.file.size
        }
      });
      req.directConversation.lastMessage = {
        sender: req.user.userId,
        username: req.user.username,
        text: caption || mediaPreviewText({ mediaType, fileName }),
        createdAt: storedMessage.createdAt
      };
      await req.directConversation.save();

      const message = publishDirectMessage(req.directConversation, storedMessage);
      res.status(201).json({ message });
    } catch (error) {
      if (fileId && !storedMessage) {
        await bucket.delete(fileId).catch(cleanupError => {
          console.error('❌ Attachment cleanup error:', cleanupError);
        });
      }
      console.error('❌ Direct media upload error:', error);
      res.status(500).json({ error: 'Unable to send attachment' });
    }
  }
);

app.get(
  '/api/conversations/:conversationId/media/:fileId',
  authenticateToken,
  findAuthorizedConversation,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) {
      return res.status(400).json({ error: 'Invalid attachment ID' });
    }

    try {
      const fileId = new mongoose.Types.ObjectId(req.params.fileId);
      const message = await DirectMessage.findOne({
        conversation: req.directConversation._id,
        'media.fileId': fileId,
        deletedAt: { $exists: false }
      }).select('media').lean();
      if (!message?.media) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'directMedia'
      });
      const downloadStream = bucket.openDownloadStream(fileId);
      const disposition = message.media.mediaType === 'document' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', message.media.mimeType);
      res.setHeader('Content-Length', message.media.size);
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(message.media.fileName)}`
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      downloadStream.on('error', error => {
        console.error('❌ Attachment download error:', error);
        if (!res.headersSent) {
          res.status(404).json({ error: 'Attachment not found' });
        } else {
          res.destroy();
        }
      });
      downloadStream.pipe(res);
    } catch (error) {
      console.error('❌ Attachment access error:', error);
      res.status(500).json({ error: 'Unable to load attachment' });
    }
  }
);

app.get('/api/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await DirectConversation.findOne({
      _id: req.params.conversationId,
      participants: req.user.userId
    }).select('_id readReceipts pinnedMessages');

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const searchTerm = String(req.query.q || '').trim().slice(0, 100);
    const messageQuery = {
      conversation: conversation._id
    };
    if (searchTerm) {
      const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      messageQuery.deletedAt = { $exists: false };
      messageQuery.$or = [
        { text: { $regex: escapedTerm, $options: 'i' } },
        { 'media.fileName': { $regex: escapedTerm, $options: 'i' } }
      ];
    }

    const messages = await DirectMessage.find(messageQuery)
      .sort({ createdAt: -1 }).limit(100).lean();
    const readReceipts = conversation.readReceipts || [];
    const pinnedMessages = await serializePinnedMessages(conversation, readReceipts);

    res.json({
      messages: messages.reverse().map(message => (
        serializeDirectMessage(message, String(conversation._id), readReceipts)
      )),
      pinnedMessages
    });
  } catch (error) {
    console.error('❌ Conversation history error:', error);
    res.status(500).json({ error: 'Unable to load messages' });
  }
});

// ==========================================
// ===== SOCKET EVENTS =====
// ==========================================

io.on('connection', (socket) => {
  console.log(`📡 ${socket.username} connected (${socket.id})`);
  socket.join(userSocketRoom(socket.userId));
  socket.data.directConversations = new Set();

  socket.on('join-conversation', async (payload, acknowledge) => {
    try {
      const conversationId = payload && typeof payload === 'object'
        ? payload.conversationId
        : null;
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid conversation ID' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      }).select('_id readReceipts pinnedMessages');

      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      const conversationIdString = String(conversation._id);
      socket.join(directConversationRoom(conversationIdString));
      socket.data.directConversations.add(conversationIdString);
      const messages = await DirectMessage.find({
        conversation: conversation._id
      }).sort({ createdAt: -1 }).limit(100).lean();
      acknowledgeSocketEvent(acknowledge, {
        messages: messages.reverse().map(message => (
          serializeDirectMessage(message, conversationIdString, conversation.readReceipts)
        )),
        pinnedMessages: await serializePinnedMessages(conversation, conversation.readReceipts)
      });
    } catch (error) {
      console.error('❌ Join direct conversation error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to open conversation' });
    }
  });

  socket.on('load-tic-tac-toe', async (payload, acknowledge) => {
    const conversationId = String(payload?.conversationId || '');
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return acknowledgeSocketEvent(acknowledge, { error: 'Invalid conversation ID' });
    }

    try {
      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      }).select('_id participants ticTacToe').populate('participants', 'username');
      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      await DirectConversation.updateOne({
        _id: conversationId,
        participants: socket.userId,
        ticTacToe: { $exists: false }
      }, {
        $set: { ticTacToe: createInitialGame() }
      });

      socket.join(directConversationRoom(conversationId));
      socket.data.directConversations.add(conversationId);
      acknowledgeSocketEvent(acknowledge, {
        ticTacToe: serializeGame(conversation.ticTacToe, conversation.participants)
      });
    } catch (error) {
      console.error('❌ Load tic-tac-toe game error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to load game' });
    }
  });

  socket.on('leave-conversation', payload => {
    const id = String(payload?.conversationId || '');
    if (socket.data.directConversations.has(id)) {
      socket.leave(directConversationRoom(id));
      socket.data.directConversations.delete(id);
    }
  });

  socket.on('mark-direct-read', async (payload, acknowledge) => {
    try {
      const conversationId = String(payload?.conversationId || '');
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid conversation ID' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });
      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      const readAt = new Date();
      const receipt = conversation.readReceipts.find(
        item => String(item.user) === String(socket.userId)
      );
      if (receipt) receipt.lastReadAt = readAt;
      else conversation.readReceipts.push({ user: socket.userId, lastReadAt: readAt });
      await conversation.save();

      const result = {
        conversationId,
        readerId: String(socket.userId),
        readAt
      };
      io.to(directConversationRoom(conversationId)).emit('direct-read-receipt', result);
      acknowledgeSocketEvent(acknowledge, { readAt });
    } catch (error) {
      console.error('❌ Mark direct messages read error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to mark messages as read' });
    }
  });

  socket.on('toggle-direct-pin', async (payload, acknowledge) => {
    try {
      const { conversationId, messageId } = payload && typeof payload === 'object'
        ? payload
        : {};
      if (!mongoose.Types.ObjectId.isValid(conversationId)
        || !mongoose.Types.ObjectId.isValid(messageId)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid message or conversation' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });
      const message = await DirectMessage.findOne({
        _id: messageId,
        conversation: conversationId,
        deletedAt: { $exists: false }
      });
      if (!conversation || !message) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Message not found' });
      }

      const pinnedIndex = conversation.pinnedMessages.findIndex(
        id => String(id) === String(messageId)
      );
      if (pinnedIndex >= 0) conversation.pinnedMessages.splice(pinnedIndex, 1);
      else conversation.pinnedMessages.push(message._id);
      await conversation.save();

      const pinnedMessages = await serializePinnedMessages(
        conversation,
        conversation.readReceipts
      );
      const result = { conversationId, pinnedMessages };
      io.to(directConversationRoom(conversationId)).emit('direct-pins-updated', result);
      acknowledgeSocketEvent(acknowledge, result);
    } catch (error) {
      console.error('❌ Toggle direct message pin error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to update pinned messages' });
    }
  });

  socket.on('edit-direct-message', async (payload, acknowledge) => {
    try {
      const { conversationId, messageId, text } = payload && typeof payload === 'object'
        ? payload
        : {};
      const cleanText = typeof text === 'string' ? text.trim() : '';
      if (!mongoose.Types.ObjectId.isValid(conversationId)
        || !mongoose.Types.ObjectId.isValid(messageId)
        || !cleanText
        || cleanText.length > 4000) {
        return acknowledgeSocketEvent(acknowledge, {
          error: 'Edited messages must contain 1 to 4000 characters'
        });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });
      const message = await DirectMessage.findOne({
        _id: messageId,
        conversation: conversationId,
        sender: socket.userId,
        deletedAt: { $exists: false }
      });
      if (!conversation || !message) {
        return acknowledgeSocketEvent(acknowledge, {
          error: 'Message not found or you cannot edit it'
        });
      }

      message.text = cleanText;
      message.editedAt = new Date();
      await message.save();
      await refreshConversationPreview(conversation);
      const serialized = serializeDirectMessage(
        message,
        conversationId,
        conversation.readReceipts
      );
      io.to(directConversationRoom(conversationId)).emit('direct-message-updated', {
        conversationId,
        message: serialized
      });
      acknowledgeSocketEvent(acknowledge, { message: serialized });
    } catch (error) {
      console.error('❌ Edit direct message error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to edit message' });
    }
  });

  socket.on('delete-direct-message', async (payload, acknowledge) => {
    try {
      const { conversationId, messageId } = payload && typeof payload === 'object'
        ? payload
        : {};
      if (!mongoose.Types.ObjectId.isValid(conversationId)
        || !mongoose.Types.ObjectId.isValid(messageId)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid message or conversation' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });
      const message = await DirectMessage.findOne({
        _id: messageId,
        conversation: conversationId,
        sender: socket.userId,
        deletedAt: { $exists: false }
      });
      if (!conversation || !message) {
        return acknowledgeSocketEvent(acknowledge, {
          error: 'Message not found or you cannot delete it'
        });
      }

      const mediaFileId = message.media?.fileId;
      message.text = '';
      message.media = undefined;
      message.reactions = {};
      message.deletedAt = new Date();
      await message.save();
      if (mediaFileId) {
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
          bucketName: 'directMedia'
        });
        await bucket.delete(mediaFileId).catch(cleanupError => {
          console.error('❌ Deleted attachment cleanup error:', cleanupError);
        });
      }

      conversation.pinnedMessages = conversation.pinnedMessages.filter(
        id => String(id) !== String(messageId)
      );
      await conversation.save();
      await refreshConversationPreview(conversation);
      const serialized = serializeDirectMessage(
        message,
        conversationId,
        conversation.readReceipts
      );
      io.to(directConversationRoom(conversationId)).emit('direct-message-updated', {
        conversationId,
        message: serialized
      });
      io.to(directConversationRoom(conversationId)).emit('direct-pins-updated', {
        conversationId,
        pinnedMessages: await serializePinnedMessages(conversation, conversation.readReceipts)
      });
      acknowledgeSocketEvent(acknowledge, { message: serialized });
    } catch (error) {
      console.error('❌ Delete direct message error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to delete message' });
    }
  });

  socket.on('react-to-direct-message', async (payload, acknowledge) => {
    try {
      const { conversationId, messageId, emoji } = payload && typeof payload === 'object'
        ? payload
        : {};
      const allowedEmojis = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '❤️'];

      if (!mongoose.Types.ObjectId.isValid(conversationId)
        || !mongoose.Types.ObjectId.isValid(messageId)
        || !allowedEmojis.includes(emoji)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid reaction' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });
      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      const message = await DirectMessage.findOne({
        _id: messageId,
        conversation: conversation._id
      });
      if (!message) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Message not found' });
      }

      const reactions = message.reactions instanceof Map
        ? message.reactions
        : new Map(Object.entries(message.reactions || {}));
      reactions.set(emoji, (reactions.get(emoji) || 0) + 1);
      message.reactions = reactions;
      await message.save();

      const serializedReactions = Object.fromEntries(reactions);
      io.to(directConversationRoom(conversationId)).emit('direct-reaction', {
        conversationId,
        messageId,
        reactions: serializedReactions
      });
      acknowledgeSocketEvent(acknowledge, { reactions: serializedReactions });
    } catch (error) {
      console.error('❌ Direct reaction error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to add reaction' });
    }
  });

  socket.on('send-direct-message', async (payload, acknowledge) => {
    try {
      const { conversationId, text, replyToId } = payload && typeof payload === 'object'
        ? payload
        : {};
      const cleanText = typeof text === 'string' ? text.trim() : '';
      if (!cleanText || cleanText.length > 4000) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Message must be between 1 and 4000 characters' });
      }

      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Invalid conversation ID' });
      }

      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      let replyTo;
      if (replyToId) {
        if (!mongoose.Types.ObjectId.isValid(replyToId)) {
          return acknowledgeSocketEvent(acknowledge, { error: 'Invalid replied-to message' });
        }
        const repliedMessage = await DirectMessage.findOne({
          _id: replyToId,
          conversation: conversation._id,
          deletedAt: { $exists: false }
        }).select('_id username text media');
        if (!repliedMessage) {
          return acknowledgeSocketEvent(acknowledge, { error: 'Replied-to message not found' });
        }
        replyTo = {
          messageId: repliedMessage._id,
          username: repliedMessage.username,
          text: repliedMessage.text || (repliedMessage.media ? 'Attachment' : '')
        };
      }

      const storedMessage = await DirectMessage.create({
        conversation: conversation._id,
        sender: socket.userId,
        username: socket.username,
        text: cleanText,
        replyTo
      });
      conversation.lastMessage = {
        sender: socket.userId,
        username: socket.username,
        text: cleanText,
        createdAt: storedMessage.createdAt
      };
      await conversation.save();

      const message = publishDirectMessage(conversation, storedMessage);
      acknowledgeSocketEvent(acknowledge, { message });
    } catch (error) {
      console.error('❌ Direct message error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to send message' });
    }
  });

  socket.on('typing-direct', payload => {
    const id = String(payload?.conversationId || '');
    if (socket.data.directConversations.has(id)) {
      socket.to(directConversationRoom(id)).emit('direct-typing', {
        conversationId: id,
        username: socket.username
      });
    }
  });

  socket.on('stop-typing-direct', payload => {
    const id = String(payload?.conversationId || '');
    if (socket.data.directConversations.has(id)) {
      socket.to(directConversationRoom(id)).emit('direct-stop-typing', { conversationId: id });
    }
  });
  
  socket.on('tic-tac-toe-move', async (payload, acknowledge) => {
    const conversationId = String(payload?.conversationId || '');
    const index = payload?.index;
    if (
      !socket.data.directConversations.has(conversationId) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 8
    ) {
      return acknowledgeSocketEvent(acknowledge, { error: 'Invalid game move' });
    }

    try {
      const conversation = await DirectConversation.findOne({
        _id: conversationId,
        participants: socket.userId
      }).populate('participants', 'username');
      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      const move = applyMove(
        conversation.ticTacToe || createInitialGame(),
        socket.userId,
        conversation.participants.map(participant => participant._id),
        index
      );
      if (move.error) {
        return acknowledgeSocketEvent(acknowledge, { error: move.error });
      }

      const moveFilter = {
        _id: conversationId,
        participants: socket.userId,
        'ticTacToe.status': move.expectedStatus,
        [`ticTacToe.board.${index}`]: 0
      };
      if (move.expectedStatus === 'playing') {
        moveFilter['ticTacToe.currentTurn'] = socket.userId;
      }

      const updatedConversation = await DirectConversation.findOneAndUpdate(
        moveFilter,
        { $set: { ticTacToe: move.state } },
        { new: true, runValidators: true }
      );
      if (!updatedConversation) {
        return acknowledgeSocketEvent(acknowledge, {
          error: 'This move was already taken or the game changed. Try again.'
        });
      }

      const serializedGame = serializeGame(updatedConversation.ticTacToe, conversation.participants);
      io.to(directConversationRoom(conversationId)).emit('tic-tac-toe-state', {
        conversationId,
        game: serializedGame
      });
      acknowledgeSocketEvent(acknowledge, { game: serializedGame });
    } catch (error) {
      console.error('❌ Tic-tac-toe move error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to save game move' });
    }
  });

  socket.on('tic-tac-toe-reset', async (payload, acknowledge) => {
    const conversationId = String(payload?.conversationId || '');
    if (!socket.data.directConversations.has(conversationId)) {
      return acknowledgeSocketEvent(acknowledge, { error: 'Open this conversation before starting a game' });
    }

    try {
      const conversation = await DirectConversation.findOneAndUpdate({
        _id: conversationId,
        participants: socket.userId
      }, {
        $set: { ticTacToe: createInitialGame() }
      }, { new: true }).populate('participants', 'username');
      if (!conversation) {
        return acknowledgeSocketEvent(acknowledge, { error: 'Conversation not found' });
      }

      const game = serializeGame(conversation.ticTacToe, conversation.participants);
      io.to(directConversationRoom(conversationId)).emit('tic-tac-toe-state', {
        conversationId,
        game
      });
      acknowledgeSocketEvent(acknowledge, { game });
    } catch (error) {
      console.error('❌ Tic-tac-toe reset error:', error);
      acknowledgeSocketEvent(acknowledge, { error: 'Unable to reset game' });
    }
  });

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
          tasks: room.tasks || [],
          scheduledMessages: room.scheduledMessages || []
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
      const role = room.createdBy === socket.username ? 'ADMIN' : 'MEMBER';
      
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
      socket.emit('task-updated', activeRoom.tasks);
      
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
  socket.on('send-message', async ({ roomId, text, image, poll, time, id }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom?.users.has(socket.id)) return;
      
      const messageId = id || (Date.now() + Math.random().toString(36).substr(2, 9));
      
      const messageData = {
        id: messageId,
        username: socket.username,
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
  socket.on('typing', ({ roomId }) => {
    if (activeRooms.get(roomId)?.users.has(socket.id)) {
      socket.to(roomId).emit('user-typing', { username: socket.username });
    }
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
  socket.on('reply-to-message', async ({ roomId, messageId, replyText, time }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom?.users.has(socket.id)) return;
      
      const originalMsg = activeRoom.messages.find(m => m.id === messageId);
      if (originalMsg) {
        const replyData = {
          id: `reply-${Date.now()}`,
          username: socket.username,
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
  socket.on('share-file', async ({ roomId, fileName, fileData, fileType, fileSize, time }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom?.users.has(socket.id)) return;
      
      const fileMessage = {
        id: `file-${Date.now()}`,
        username: socket.username,
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

  // ===== READ RECEIPTS =====
  socket.on('message-read', async ({ roomId, messageId }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      if (!activeRoom?.users.has(socket.id)) return;

      const message = activeRoom.messages.find(item => item.id === messageId);
      if (!message) return;

      message.readBy = Array.isArray(message.readBy) ? message.readBy : [];
      if (!message.readBy.includes(socket.username)) {
        message.readBy.push(socket.username);
        message.readCount = message.readBy.length;

        const room = await Room.findOne({ roomId });
        const dbMessage = room?.messages.find(item => item.id === messageId);
        if (dbMessage) {
          dbMessage.readBy = message.readBy;
          dbMessage.readCount = message.readCount;
          await room.save();
        }
      }

      io.to(roomId).emit('read-receipt', {
        messageId,
        readBy: message.readBy,
        readCount: message.readCount
      });
    } catch (error) {
      console.error('❌ Read receipt error:', error);
    }
  });

  // ===== UPDATE PROFILE =====
  socket.on('update-profile', async ({ roomId, avatar, bio }) => {
    try {
      const activeRoom = activeRooms.get(roomId);
      const roomUser = activeRoom?.users.get(socket.id);
      if (!roomUser) return;

      const user = await User.findOne({ username: socket.username });
      if (user) {
        user.avatar = typeof avatar === 'string' ? avatar.slice(0, 3_000_000) : user.avatar;
        user.bio = typeof bio === 'string' ? bio.trim().slice(0, 280) : user.bio;
        await user.save();
      }

      roomUser.avatar = user?.avatar || roomUser.avatar;
      roomUser.bio = user?.bio || roomUser.bio;
      io.to(roomId).emit('user-joined', {
        users: Array.from(activeRoom.users.values()),
        userId: null
      });
      socket.emit('notification', 'Profile updated successfully');
    } catch (error) {
      console.error('❌ Update profile error:', error);
      socket.emit('error', 'Unable to update profile');
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
      const remainingSockets = await io.in(userSocketRoom(socket.userId)).fetchSockets();
      const user = remainingSockets.length === 0
        ? await User.findOne({ username: socket.username })
        : null;
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