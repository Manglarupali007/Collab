const mongoose = require('mongoose');

const DirectMessageMediaSchema = new mongoose.Schema({
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  fileName: {
    type: String,
    required: true,
    maxlength: 180
  },
  mimeType: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ['image', 'video', 'audio', 'document'],
    required: true
  },
  size: {
    type: Number,
    required: true,
    min: 1
  }
}, { _id: false });

const DirectMessageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DirectConversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  text: {
    type: String,
    default: '',
    trim: true,
    maxlength: 4000
  },
  media: {
    type: DirectMessageMediaSchema,
    default: undefined
  },
  reactions: {
    type: Map,
    of: {
      type: Number,
      min: 0
    },
    default: {}
  },
  replyTo: {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DirectMessage'
    },
    username: String,
    text: {
      type: String,
      maxlength: 200
    }
  },
  editedAt: Date,
  deletedAt: Date
}, { timestamps: true });

DirectMessageSchema.pre('validate', function validateTextOrMedia() {
  if (!this.deletedAt && !this.text && !this.media?.fileId) {
    this.invalidate('text', 'A message must contain text or an attachment');
  }
});

DirectMessageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model('DirectMessage', DirectMessageSchema);
