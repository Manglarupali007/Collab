const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');

test('legacy plain-text passwords can still be validated and upgraded', async () => {
  const user = new User({ username: 'legacyuser', password: 'secret123' });
  user.save = async () => user;

  const isMatch = await new Promise((resolve, reject) => {
    user.comparePassword('secret123', (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

  assert.equal(isMatch, true);
  assert.notEqual(user.password, 'secret123');
});
