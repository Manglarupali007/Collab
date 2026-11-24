const mongoose = require('mongoose');

const DirectConversationSchema = new mongoose.Schema({
  participants: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }],
    required: true,
    validate: {
      validator: participants => participants.length === 2,
      message: 'A direct conversation must have exactly two participants'
    }
  },
  participantKey: {
    type: String,
    required: true,
    unique: true
  },
  lastMessage: {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    text: String,
    createdAt: Date
  },
  readReceipts: {
    type: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      lastReadAt: {
        type: Date,
        required: true
      }
    }],
    default: []
  },
  pinnedMessages: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DirectMessage'
    }],
    default: []
  },
  ticTacToe: {
    type: new mongoose.Schema({
      board: {
        type: [{ type: Number, enum: [0, 1, 2] }],
        default: () => Array(9).fill(0)
      },
      players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      currentTurn: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      status: {
        type: String,
        enum: ['waiting', 'playing', 'won', 'draw'],
        default: 'waiting'
      },
      winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      }
    }, { _id: false }),
    default: () => ({})
  }
}, { timestamps: true });

DirectConversationSchema.index({ participants: 1, updatedAt: -1 });

module.exports = mongoose.model('DirectConversation', DirectConversationSchema);
