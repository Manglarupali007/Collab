const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const DirectConversation = require('../models/DirectConversation');
const {
  applyMove,
  createInitialGame,
  getWinningMark,
  serializeGame
} = require('../services/ticTacToe');

test('tic-tac-toe detects wins across rows, columns, and diagonals', () => {
  assert.equal(getWinningMark([1, 1, 1, 2, 0, 0, 0, 2, 0]), 1);
  assert.equal(getWinningMark([2, 1, 0, 2, 1, 0, 2, 0, 1]), 2);
  assert.equal(getWinningMark([1, 2, 2, 0, 1, 0, 2, 0, 1]), 1);
  assert.equal(getWinningMark([1, 2, 1, 1, 2, 2, 2, 1, 1]), null);
});

test('tic-tac-toe state starts empty and serializes player marks for both users', () => {
  const firstUser = new mongoose.Types.ObjectId();
  const secondUser = new mongoose.Types.ObjectId();
  const initialGame = createInitialGame();
  assert.deepEqual(initialGame.board, Array(9).fill(0));
  assert.equal(initialGame.status, 'waiting');

  const game = serializeGame({
    board: [1, 2, 0, 0, 0, 0, 0, 0, 0],
    players: [firstUser, secondUser],
    currentTurn: secondUser,
    status: 'playing',
    winner: null
  }, [
    { _id: firstUser, username: 'alpha' },
    { _id: secondUser, username: 'beta' }
  ]);

  assert.equal(game.players[0].mark, 'X');
  assert.equal(game.players[1].mark, 'O');
  assert.equal(game.currentTurn, 'beta');
});

test('direct conversations initialize a persisted tic-tac-toe game', async () => {
  const firstUser = new mongoose.Types.ObjectId();
  const secondUser = new mongoose.Types.ObjectId();
  const conversation = new DirectConversation({
    participants: [firstUser, secondUser],
    participantKey: [String(firstUser), String(secondUser)].sort().join(':')
  });

  assert.deepEqual(conversation.ticTacToe.board.map(Number), Array(9).fill(0));
  assert.equal(conversation.ticTacToe.status, 'waiting');
  await assert.doesNotReject(conversation.validate());
});

test('tic-tac-toe enforces turns and records the winner', () => {
  const firstMove = applyMove(createInitialGame(), 'alpha', ['alpha', 'beta'], 0);
  assert.equal(firstMove.state.board[0], 1);
  assert.equal(firstMove.state.currentTurn, 'beta');

  const wrongTurn = applyMove(firstMove.state, 'alpha', ['alpha', 'beta'], 1);
  assert.equal(wrongTurn.error, 'Wait for your turn');

  const secondMove = applyMove(firstMove.state, 'beta', ['alpha', 'beta'], 1);
  const thirdMove = applyMove(secondMove.state, 'alpha', ['alpha', 'beta'], 4);
  const fourthMove = applyMove(thirdMove.state, 'beta', ['alpha', 'beta'], 2);
  const winningMove = applyMove(fourthMove.state, 'alpha', ['alpha', 'beta'], 8);

  assert.equal(winningMove.state.status, 'won');
  assert.equal(winningMove.state.winner, 'alpha');
  assert.equal(applyMove(winningMove.state, 'beta', ['alpha', 'beta'], 3).error, 'Start a new game to play again');
});
