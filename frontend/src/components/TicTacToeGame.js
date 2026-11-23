import React, { useEffect, useState } from 'react';
import './TicTacToeGame.css';
import TicTacToe from './TicTacToe';

const EMPTY_GAME = {
  board: Array(9).fill(0),
  players: [],
  currentTurn: null,
  status: 'waiting',
  winner: null
};

function TicTacToeGame({ conversationId, socket, username, onClose }) {
  const [game, setGame] = useState(EMPTY_GAME);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const handleGameState = payload => {
      if (payload.conversationId !== conversationId) return;
      setGame(payload.game);
      setBusy(false);
    };

    socket.on('tic-tac-toe-state', handleGameState);
    socket.emit('load-tic-tac-toe', { conversationId }, response => {
      if (!active) return;
      if (response?.error) {
        setError(response.error);
      } else {
        setGame(response.ticTacToe || EMPTY_GAME);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      socket.off('tic-tac-toe-state', handleGameState);
    };
  }, [conversationId, socket]);

  const makeMove = index => {
    if (!socket?.connected || loading || busy) return;
    setBusy(true);
    setError('');
    socket.emit('tic-tac-toe-move', { conversationId, index }, response => {
      if (response?.error) {
        setError(response.error);
        setBusy(false);
        return;
      }
      if (response?.game) setGame(response.game);
      setBusy(false);
    });
  };

  const resetGame = () => {
    if (!socket?.connected || loading || busy) return;
    setBusy(true);
    setError('');
    socket.emit('tic-tac-toe-reset', { conversationId }, response => {
      if (response?.error) {
        setError(response.error);
        setBusy(false);
        return;
      }
      if (response?.game) setGame(response.game);
      setBusy(false);
    });
  };

  return (
    <div className="dm-game-backdrop">
      <section className="dm-game-dialog" role="dialog" aria-modal="true" aria-labelledby="dm-game-title">
        <header className="dm-game-header">
          <div>
            <span className="dm-overline">A LITTLE FRIENDLY COMPETITION</span>
            <h2 id="dm-game-title">Tic-tac-toe</h2>
          </div>
          <button type="button" className="dm-game-close" onClick={onClose} aria-label="Close game">×</button>
        </header>

        <TicTacToe
          game={game}
          username={username}
          onMove={makeMove}
          onReset={resetGame}
          busy={busy || loading}
        />
        {error && <p className="dm-game-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

export default TicTacToeGame;
