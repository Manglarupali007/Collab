const test = require('node:test');
const assert = require('node:assert/strict');
const { getMediaType, validateMediaFile } = require('../services/mediaValidation');

test('media uploads require an allowed extension and matching content type', () => {
  assert.equal(getMediaType({ originalname: 'photo.png', mimetype: 'image/png' }), 'image');
  assert.throws(
    () => getMediaType({ originalname: 'photo.png', mimetype: 'application/pdf' }),
    /Unsupported file type/
  );
  assert.throws(
    () => getMediaType({ originalname: 'script.svg', mimetype: 'image/svg+xml' }),
    /Unsupported file type/
  );
});

test('media uploads validate file signatures and text encoding', () => {
  const png = {
    originalname: 'photo.png',
    mimetype: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex')
  };
  assert.equal(validateMediaFile(png), 'image');

  assert.throws(
    () => validateMediaFile({ ...png, buffer: Buffer.from('not a png') }),
    /contents do not match/
  );
  assert.equal(validateMediaFile({
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('Hello Nexus', 'utf8')
  }), 'document');
});

test('voice notes accept WebM audio with a valid container signature', () => {
  const voiceNote = {
    originalname: 'voice-note.webm',
    mimetype: 'audio/webm',
    buffer: Buffer.from('1a45dfa3', 'hex')
  };
  assert.equal(getMediaType(voiceNote), 'audio');
  assert.equal(validateMediaFile(voiceNote), 'audio');
  assert.throws(
    () => validateMediaFile({ ...voiceNote, buffer: Buffer.from('not audio') }),
    /contents do not match/
  );
});
