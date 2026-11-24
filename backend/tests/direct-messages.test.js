const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const DirectConversation = require('../models/DirectConversation');
const DirectMessage = require('../models/DirectMessage');

test('direct conversations require exactly two participants', async () => {
  const firstUser = new mongoose.Types.ObjectId();
  const secondUser = new mongoose.Types.ObjectId();

  const conversation = new DirectConversation({
    participants: [firstUser, secondUser],
    participantKey: [String(firstUser), String(secondUser)].sort().join(':')
  });
  await assert.doesNotReject(conversation.validate());

  const invalidConversation = new DirectConversation({
    participants: [firstUser],
    participantKey: String(firstUser)
  });
  await assert.rejects(invalidConversation.validate(), /exactly two participants/);
});

test('direct messages enforce message content and length', async () => {
  const message = new DirectMessage({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    username: 'chatuser',
    text: '  Hello there  '
  });
  await message.validate();
  assert.equal(message.text, 'Hello there');

  message.text = 'x'.repeat(4001);
  await assert.rejects(message.validate());
});

test('direct messages allow attachments without text but reject empty messages', async () => {
  const message = new DirectMessage({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    username: 'chatuser',
    media: {
      fileId: new mongoose.Types.ObjectId(),
      fileName: 'photo.png',
      mimeType: 'image/png',
      mediaType: 'image',
      size: 12
    }
  });
  await assert.doesNotReject(message.validate());

  const emptyMessage = new DirectMessage({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    username: 'chatuser'
  });
  await assert.rejects(emptyMessage.validate(), /text/);
});

test('direct message replies and edited timestamps validate', async () => {
  const message = new DirectMessage({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    username: 'chatuser',
    text: 'Reply',
    replyTo: {
      messageId: new mongoose.Types.ObjectId(),
      username: 'anotheruser',
      text: 'Original message'
    },
    editedAt: new Date()
  });
  await assert.doesNotReject(message.validate());
  assert.equal(message.replyTo.username, 'anotheruser');
});

test('soft-deleted messages can remain as valid tombstones', async () => {
  const message = new DirectMessage({
    conversation: new mongoose.Types.ObjectId(),
    sender: new mongoose.Types.ObjectId(),
    username: 'chatuser',
    text: '',
    deletedAt: new Date()
  });
  await assert.doesNotReject(message.validate());
});

test('direct conversations validate read receipts and pinned message IDs', async () => {
  const firstUser = new mongoose.Types.ObjectId();
  const secondUser = new mongoose.Types.ObjectId();
  const conversation = new DirectConversation({
    participants: [firstUser, secondUser],
    participantKey: [String(firstUser), String(secondUser)].sort().join(':'),
    readReceipts: [{ user: firstUser, lastReadAt: new Date() }],
    pinnedMessages: [new mongoose.Types.ObjectId()]
  });

  await assert.doesNotReject(conversation.validate());
});
