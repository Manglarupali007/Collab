const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  avatar: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    default: ''
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['online', 'away', 'busy', 'offline'],
    default: 'offline'
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

// Hash password before saving while preserving compatibility with existing accounts
UserSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }

  if (!this.password) {
    throw new Error('Password is required');
  }

  if (!isBcryptHash(this.password)) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

// Compare password method
UserSchema.methods.comparePassword = function(candidatePassword, callback) {
  const user = this;

  bcrypt.compare(candidatePassword, user.password, async (err, isMatch) => {
    if (err) return callback(err);

    if (isMatch) return callback(null, true);

    if (user.password === candidatePassword) {
      try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(candidatePassword, salt);
        user.password = hash;
        await user.save({ validateBeforeSave: false });
        return callback(null, true);
      } catch (saveErr) {
        return callback(saveErr);
      }
    }

    callback(null, false);
  });
};

// Promise based compare (for async/await)
UserSchema.methods.comparePasswordAsync = async function(candidatePassword) {
  const user = this;

  const isMatch = await bcrypt.compare(candidatePassword, user.password);
  if (isMatch) return true;

  if (user.password === candidatePassword) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(candidatePassword, salt);
    user.password = hash;
    await user.save({ validateBeforeSave: false });
    return true;
  }

  return false;
};

module.exports = mongoose.model('User', UserSchema);