import React from 'react';

function TicTacToe({ game, username, onMove, onReset, busy }) {
  const myPlayer = game.players.find(player => player.username === username);
  const canPlay = game.status === 'waiting' ||
    (game.status === 'playing' && game.currentTurn === username);

  let statusText = busy ? 'Syncing the shared board…' : 'Either player can make the opening move.';
  if (game.status === 'playing') {
    statusText = game.currentTurn === username
      ? 'Your turn'
      : `${game.currentTurn || 'Your opponent'} is making a move`;
  } else if (game.status === 'won') {
    statusText = game.winner === username ? 'You won!' : `${game.winner || 'Your opponent'} won`;
  } else if (game.status === 'draw') {
    statusText = "It's a draw!";
  }

  return (
    <div className="dm-game">
      <div className="dm-game-heading">
        <span className="dm-overline">YOUR SHARED BOARD</span>
        <h3>Tic-tac-toe</h3>
        <p aria-live="polite">{statusText}</p>
      </div>

      <div className="dm-game-players">
        <span className={game.currentTurn === game.players[0]?.username ? 'is-turn' : ''}>
          <strong>X</strong>
          {game.players[0]?.username || 'First move'}
        </span>
        <span className={game.currentTurn === game.players[1]?.username ? 'is-turn' : ''}>
          <strong>O</strong>
          {game.players[1]?.username || 'Opponent'}
        </span>
      </div>

      <div className="dm-game-grid" role="group" aria-label="Tic-tac-toe board">
        {game.board.map((mark, index) => (
          <button
            type="button"
            className={`dm-game-cell ${mark === 1 ? 'is-x' : ''} ${mark === 2 ? 'is-o' : ''}`}
            key={index}
            onClick={() => onMove(index)}
            disabled={!canPlay || Boolean(mark) || busy}
            aria-label={`Square ${index + 1}: ${mark === 1 ? 'X' : mark === 2 ? 'O' : 'empty'}`}
          >
            {mark === 1 ? 'X' : mark === 2 ? 'O' : ''}
          </button>
        ))}
      </div>

      {myPlayer && <p className="dm-game-you">You are playing as {myPlayer.mark}.</p>}
      {game.status !== 'waiting' && (
        <button type="button" className="dm-game-reset" onClick={onReset} disabled={busy}>
          {busy ? 'Updating…' : 'Start a new game'}
        </button>
      )}
    </div>
  );
}

export default TicTacToe;
