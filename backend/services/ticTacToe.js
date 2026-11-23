const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function createInitialGame() {
  return {
    board: Array(9).fill(0),
    players: [],
    currentTurn: null,
    status: 'waiting',
    winner: null
  };
}

function getWinningMark(board) {
  for (const [first, second, third] of winningLines) {
    if (board[first] && board[first] === board[second] && board[first] === board[third]) {
      return board[first];
    }
  }
  return null;
}

function applyMove(game, userId, participantIds, index) {
  const currentStatus = game?.status || 'waiting';
  const board = game?.board?.length === 9 ? game.board.map(Number) : Array(9).fill(0);
  const user = String(userId);

  if (!Number.isInteger(index) || index < 0 || index > 8) {
    return { error: 'Choose a valid square' };
  }
  if (currentStatus !== 'waiting' && currentStatus !== 'playing') {
    return { error: 'Start a new game to play again' };
  }
  if (board[index] !== 0) {
    return { error: 'That square is already taken' };
  }

  let players = (game?.players || []).map(String);
  if (currentStatus === 'waiting') {
    const otherPlayer = participantIds.map(String).find(playerId => playerId !== user);
    if (!participantIds.map(String).includes(user) || !otherPlayer) {
      return { error: 'Game players are unavailable' };
    }
    players = [user, otherPlayer];
  } else if (!players.includes(user) || String(game.currentTurn) !== user) {
    return { error: 'Wait for your turn' };
  }

  board[index] = players[0] === user ? 1 : 2;
  const winningMark = getWinningMark(board);
  const status = winningMark
    ? 'won'
    : board.every(mark => mark !== 0) ? 'draw' : 'playing';

  return {
    expectedStatus: currentStatus,
    state: {
      board,
      players,
      currentTurn: status === 'playing'
        ? players.find(playerId => playerId !== user)
        : null,
      status,
      winner: winningMark ? user : null
    }
  };
}

function serializeGame(game, participants) {
  const usersById = new Map(participants.map(participant => [
    String(participant._id),
    participant.username
  ]));
  const players = (game.players || []).map((playerId, index) => ({
    id: String(playerId),
    username: usersById.get(String(playerId)) || 'Nexus user',
    mark: index === 0 ? 'X' : 'O'
  }));
  const usernameFor = userId => userId ? usersById.get(String(userId)) || null : null;

  return {
    board: game.board?.length === 9 ? game.board.map(Number) : Array(9).fill(0),
    players,
    currentTurn: usernameFor(game.currentTurn),
    status: game.status || 'waiting',
    winner: usernameFor(game.winner)
  };
}

module.exports = {
  applyMove,
  createInitialGame,
  getWinningMark,
  serializeGame
};
