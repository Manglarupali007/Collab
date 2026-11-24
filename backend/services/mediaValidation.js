const path = require('path');
const { TextDecoder } = require('node:util');

const fileTypes = {
  '.png': { mediaType: 'image', mimeTypes: ['image/png'] },
  '.jpg': { mediaType: 'image', mimeTypes: ['image/jpeg'] },
  '.jpeg': { mediaType: 'image', mimeTypes: ['image/jpeg'] },
  '.gif': { mediaType: 'image', mimeTypes: ['image/gif'] },
  '.webp': { mediaType: 'image', mimeTypes: ['image/webp'] },
  '.mp4': { mediaType: 'video', mimeTypes: ['video/mp4'] },
  '.webm': { mediaType: 'video', mimeTypes: ['video/webm', 'audio/webm'] },
  '.pdf': { mediaType: 'document', mimeTypes: ['application/pdf'] },
  '.doc': { mediaType: 'document', mimeTypes: ['application/msword'] },
  '.docx': {
    mediaType: 'document',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  },
  '.xls': { mediaType: 'document', mimeTypes: ['application/vnd.ms-excel'] },
  '.xlsx': {
    mediaType: 'document',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  },
  '.ppt': { mediaType: 'document', mimeTypes: ['application/vnd.ms-powerpoint'] },
  '.pptx': {
    mediaType: 'document',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation']
  },
  '.txt': { mediaType: 'document', mimeTypes: ['text/plain'] },
  '.csv': { mediaType: 'document', mimeTypes: ['text/csv', 'application/vnd.ms-excel'] }
};

function getMediaType(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const definition = fileTypes[extension];
  if (!definition || !definition.mimeTypes.includes(file.mimetype)) {
    throw new Error('Unsupported file type. Choose an image, video, or document.');
  }
  return file.mimetype.startsWith('audio/') ? 'audio' : definition.mediaType;
}

function hasValidSignature(file, extension) {
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;

  switch (extension) {
    case '.png':
      return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case '.jpg':
    case '.jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case '.gif':
      return ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6));
    case '.webp':
      return buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'WEBP';
    case '.mp4':
      return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
    case '.webm':
      return buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
    case '.pdf':
      return buffer.toString('ascii', 0, 5) === '%PDF-';
    case '.doc':
    case '.xls':
    case '.ppt':
      return buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    case '.docx':
    case '.xlsx':
    case '.pptx':
      return buffer.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
    case '.txt':
    case '.csv':
      if (buffer.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return true;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function validateMediaFile(file) {
  const mediaType = getMediaType(file);
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!hasValidSignature(file, extension)) {
    throw new Error('The file contents do not match the selected file type.');
  }
  return mediaType;
}

module.exports = { getMediaType, validateMediaFile };
