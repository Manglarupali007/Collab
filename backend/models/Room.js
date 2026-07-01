const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  roomName: {
    type: String,
    default: ''
  },
  roomType: {
    type: String,
    enum: ['private', 'group'],
    default: 'private'
  },
  password: {
    type: String,
    default: ''
  },
  createdBy: {
    type: String,
    required: true
  },
  groupAdmins: [{
    type: String,
    default: []
  }],
  users: [{
    username: String,
    socketId: String,
    role: {
      type: String,
      enum: ['ADMIN', 'MANAGER', 'MEMBER'],
      default: 'MEMBER'
    },
    status: {
      type: String,
      enum: ['online', 'away', 'busy', 'offline'],
      default: 'offline'
    },
    avatar: String,
    bio: String,
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  messages: [{
    id: String,
    username: String,
    text: String,
    image: String,
    poll: Object,
    reactions: Object,
    time: String,
    readBy: [String],
    readCount: {
      type: Number,
      default: 0
    },
    edited: {
      type: Boolean,
      default: false
    },
    editedAt: String,
    replyTo: Object,
    file: Object,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  pinnedMessages: [{
    id: String,
    username: String,
    text: String,
    pinnedBy: String,
    pinnedAt: Date
  }],
  tasks: [{
    id: Number,
    title: String,
    status: {
      type: String,
      enum: ['todo', 'doing', 'done'],
      default: 'todo'
    },
    assignee: String,
    createdBy: String,
    createdAt: Date
  }],
  scheduledMessages: [{
    username: String,
    text: String,
    scheduledTime: Date,
    time: String
  }],
  inviteLinks: [{
    code: String,
    expiresAt: Date,
    maxUses: Number,
    uses: {
      type: Number,
      default: 0
    },
    createdBy: String
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Room', RoomSchema);