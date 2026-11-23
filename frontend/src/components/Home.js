import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="Nexus chat brand">
      #
    </div>
  );
}

function InputField({
  value,
  onChange,
  placeholder,
  type = 'text',
  icon,
  onTogglePassword,
  showPassword,
  onKeyDown
}) {
  return (
    <div className="input-shell">
      <span className="input-icon">{icon}</span>

      <input
        type={type}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="auth-input"
        autoComplete={type === 'password' ? 'current-password' : 'username'}
      />

      {onTogglePassword && (
        <button
          type="button"
          className="eye-button"
          onClick={onTogglePassword}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? '🙈' : '👁'}
        </button>
      )}
    </div>
  );
}

function Home() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSignup, setIsSignup] = useState(false);

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState(null);

  const navigate = useNavigate();

  const backendURL =
    process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

  /* =========================
     CHECK LOGIN
  ========================= */

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (token) {
      navigate('/messages', { replace: true });
    }
  }, [navigate]);

  /* =========================
     TOAST
  ========================= */

  const showToast = (message, type = 'info') => {
    setToast({ message, type });

    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  /* =========================
     LOGIN / SIGNUP
  ========================= */

  const handleAuth = async () => {
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      showToast('Please enter your username.', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must contain at least 6 characters.', 'error');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isSignup
        ? '/api/register'
        : '/api/login';

      const response = await axios.post(
        `${backendURL}${endpoint}`,
        {
          username: cleanUsername,
          password
        }
      );

      if (isSignup) {
        showToast(
          'Account created successfully. Please login.',
          'success'
        );

        setIsSignup(false);
        setPassword('');
      } else {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem(
          'username',
          response.data.username
        );

        navigate('/messages');
      }
    } catch (error) {
      showToast(
        error.response?.data?.error ||
          'Authentication failed. Please try again.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     LOGOUT
  ========================= */

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');

    setIsLoggedIn(false);
    setRoomId('');

    showToast('You have been logged out.', 'info');
  };

  /* =========================
     CREATE PRIVATE ROOM
  ========================= */

  const createRoom = () => {
    const roomPass = window.prompt(
      '🔒 Set a password for this private room:'
    );

    if (!roomPass || roomPass.length < 4) {
      showToast(
        'Room password must contain at least 4 characters.',
        'error'
      );
      return;
    }

    const id = Math.random()
      .toString(36)
      .substring(2, 10);

    navigate(`/editor/${id}`, {
      state: {
        username: localStorage.getItem('username'),
        password: roomPass
      }
    });
  };

  /* =========================
     JOIN ROOM
  ========================= */

  const joinRoom = () => {
    const cleanRoomId = roomId.trim();

    if (!cleanRoomId) {
      showToast('Please enter a room ID.', 'error');
      return;
    }

    const roomPass = window.prompt(
      '🔑 Enter room password:'
    );

    if (!roomPass) {
      showToast(
        'Room password is required.',
        'error'
      );
      return;
    }

    navigate(`/editor/${cleanRoomId}`, {
      state: {
        username: localStorage.getItem('username'),
        password: roomPass
      }
    });
  };

  /* =========================
     KEYBOARD
  ========================= */

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !loading) {
      handleAuth();
    }
  };

  return (
    <main className="nexus-page">

      {/* Background glow */}
      <div className="nexus-glow nexus-glow-one" />
      <div className="nexus-glow nexus-glow-two" />

      {/* Toast */}
      {toast && (
        <div
          className={`nexus-toast nexus-toast-${toast.type}`}
          role="alert"
        >
          <span className="toast-dot" />
          <span>{toast.message}</span>
        </div>
      )}

      {/* =========================
          MAIN CONTENT
      ========================= */}

      <section className="nexus-container">

        {/* =========================
            LEFT / HERO
        ========================= */}

        <div className="nexus-hero">

          <div className="nexus-eyebrow">
            <span className="eyebrow-dot" />
            Private conversations
          </div>

          <h1 className="nexus-title">
            One-to-one
            <br />
            conversations,
            <span> in real time.</span>
          </h1>

          <p className="nexus-description">
            Find someone, start a private chat, and stay connected with
            fast, live messaging that feels effortless.
          </p>

          <div className="nexus-points">

            <div className="nexus-point">
              <div className="point-icon">⌁</div>
              <div>
                <strong>Live messaging</strong>
                <span>Messages arrive instantly</span>
              </div>
            </div>

            <div className="nexus-point">
              <div className="point-icon">⌕</div>
              <div>
                <strong>One-to-one</strong>
                <span>Conversations stay between you</span>
              </div>
            </div>

            <div className="nexus-point">
              <div className="point-icon">✓</div>
              <div>
                <strong>Responsive by design</strong>
                <span>Chat smoothly on any screen</span>
              </div>
            </div>

          </div>

          <div className="nexus-security">
            <span className="security-lock">●</span>
            Private direct messages
            <span className="security-separator">•</span>
            Powered by Socket.IO
          </div>

        </div>

        {/* =========================
            RIGHT / AUTH
        ========================= */}

        <div className="nexus-auth-wrapper">

          <div className="nexus-auth-card">

            {/* Brand */}

            <div className="nexus-brand">

              <div className="nexus-brand-icon">
                <BrandMark />
              </div>

              <div className="nexus-brand-name">
                NEXUS
              </div>

              <div className="nexus-brand-tagline">
                CONNECT · COLLABORATE · CREATE
              </div>

            </div>

            {!isLoggedIn ? (

              /* =========================
                 LOGIN / SIGNUP
              ========================= */

              <div className="auth-content">

                <div className="auth-heading">
                  <h2>
                    {isSignup
                      ? 'Create your account'
                      : 'Welcome back'}
                  </h2>

                  <p>
                    {isSignup
                      ? 'Create an account to start private conversations.'
                      : 'Sign in to continue to your workspace.'}
                  </p>
                </div>

                <div className="auth-form">

                  <InputField
                    value={username}
                    onChange={(event) =>
                      setUsername(event.target.value)
                    }
                    placeholder="Username"
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        width="17"
                        height="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    }
                    onKeyDown={handleKeyDown}
                  />

                  <InputField
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="Password"
                    type={
                      showPassword
                        ? 'text'
                        : 'password'
                    }
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        width="17"
                        height="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="10"
                          rx="2"
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    }
                    onTogglePassword={() =>
                      setShowPassword((prev) => !prev)
                    }
                    showPassword={showPassword}
                    onKeyDown={handleKeyDown}
                  />

                  <button
                    type="button"
                    className="nexus-primary-button"
                    onClick={handleAuth}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="button-spinner" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {isSignup
                          ? 'Create account'
                          : 'Sign in'}
                        <span className="button-arrow">
                          →
                        </span>
                      </>
                    )}
                  </button>

                </div>

                <div className="auth-switch">
                  <span>
                    {isSignup
                      ? 'Already have an account?'
                      : 'New to Nexus?'}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSignup((prev) => !prev);
                      setPassword('');
                    }}
                  >
                    {isSignup
                      ? 'Sign in'
                      : 'Create account'}
                  </button>
                </div>

              </div>

            ) : (

              /* =========================
                 LOGGED IN
              ========================= */

              <div className="workspace-content">

                <div className="auth-heading">
                  <h2>
                    Your conversations
                  </h2>

                  <p>
                    Start a private one-to-one chat or open a room.
                  </p>
                </div>

                {/* User */}

                <div className="logged-user">

                  <div className="logged-avatar">
                    {(localStorage.getItem('username') || 'U')
                      .charAt(0)
                      .toUpperCase()}
                  </div>

                  <div className="logged-user-info">
                    <span>Signed in as</span>
                    <strong>
                      {localStorage.getItem('username')}
                    </strong>
                  </div>

                  <span className="online-status">
                    Online
                  </span>

                </div>

                <button
                  type="button"
                  className="create-room-button"
                  onClick={() => navigate('/messages')}
                >
                  <span className="create-icon">✳</span>
                  <span>
                    <strong>Open direct messages</strong>
                    <small>Find people and chat privately</small>
                  </span>
                  <span className="create-arrow">→</span>
                </button>

                <div className="or-divider">
                  <span>OR JOIN A ROOM</span>
                </div>

                {/* Join */}

                <div className="room-section">

                  <label>
                    JOIN A ROOM
                  </label>

                  <div className="room-input-row">

                    <input
                      type="text"
                      placeholder="Enter room ID"
                      value={roomId}
                      onChange={(event) =>
                        setRoomId(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          joinRoom();
                        }
                      }}
                    />

                    <button
                      type="button"
                      onClick={joinRoom}
                    >
                      Join
                    </button>

                  </div>

                </div>

                <div className="or-divider">
                  <span>OR</span>
                </div>

                {/* Create */}

                <button
                  type="button"
                  className="create-room-button"
                  onClick={createRoom}
                >
                  <span className="create-icon">
                    +
                  </span>

                  <span>
                    <strong>
                      Create private room
                    </strong>

                    <small>
                      Start a secure workspace
                    </small>
                  </span>

                  <span className="create-arrow">
                    →
                  </span>
                </button>

                <button
                  type="button"
                  className="logout-button"
                  onClick={handleLogout}
                >
                  Sign out
                </button>

              </div>

            )}

            <div className="auth-footer">
              <span className="footer-lock">●</span>
              Your conversations stay private
            </div>

          </div>

        </div>

      </section>

    </main>
  );
}

export default Home;