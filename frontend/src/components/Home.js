import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

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

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) setIsLoggedIn(true);
  }, []);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleAuth = async () => {
    if (!username.trim() || password.length < 6) {
      showToast('Username and password (min 6 chars) required', 'error');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isSignup ? '/api/register' : '/api/login';
      const res = await axios.post(`${process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000'}${endpoint}`, { 
        username: username.trim(), 
        password 
      });
      
      if (isSignup) {
        showToast('🎉 Registration successful! Please login.', 'success');
        setIsSignup(false);
        setPassword('');
      } else {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('username', res.data.username);
        setIsLoggedIn(true);
        showToast(`👋 Welcome back, ${res.data.username}!`, 'success');
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setIsLoggedIn(false);
    showToast('Logged out successfully', 'info');
  };

  const createRoom = () => {
    const roomPass = prompt('🔒 Set a password for this private room:');
    if (!roomPass || roomPass.length < 4) {
      showToast('Password must be at least 4 characters', 'error');
      return;
    }
    const id = Math.random().toString(36).substr(2, 8);
    navigate(`/editor/${id}`, { 
      state: { 
        username: localStorage.getItem('username'), 
        password: roomPass 
      } 
    });
  };

  const joinRoom = () => {
    if (!roomId.trim()) {
      showToast('Please enter a room ID', 'error');
      return;
    }
    const roomPass = prompt('🔑 Enter room password:');
    if (!roomPass) {
      showToast('Password is required to join', 'error');
      return;
    }
    navigate(`/editor/${roomId.trim()}`, { 
      state: { 
        username: localStorage.getItem('username'), 
        password: roomPass 
      } 
    });
  };

  // ===== STYLES =====
  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: '#0a0f1e',
      position: 'relative',
      overflow: 'hidden'
    },
    bgBlur1: {
      position: 'absolute',
      top: '-20%',
      left: '-10%',
      width: '50%',
      height: '50%',
      background: 'rgba(59, 130, 246, 0.1)',
      borderRadius: '50%',
      filter: 'blur(120px)',
      pointerEvents: 'none'
    },
    bgBlur2: {
      position: 'absolute',
      bottom: '-20%',
      right: '-10%',
      width: '50%',
      height: '50%',
      background: 'rgba(139, 92, 246, 0.1)',
      borderRadius: '50%',
      filter: 'blur(120px)',
      pointerEvents: 'none'
    },
    bgBlur3: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '40%',
      height: '40%',
      background: 'rgba(16, 185, 129, 0.05)',
      borderRadius: '50%',
      filter: 'blur(100px)',
      pointerEvents: 'none'
    },
    card: {
      position: 'relative',
      zIndex: 10,
      width: '100%',
      maxWidth: '440px',
      background: 'rgba(255, 255, 255, 0.06)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '24px',
      padding: '32px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 40px rgba(59,130,246,0.15)'
    },
    logoContainer: {
      textAlign: 'center',
      marginBottom: '40px'
    },
    logoBox: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '80px',
      height: '80px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      marginBottom: '16px',
      boxShadow: '0 0 40px rgba(59,130,246,0.25)'
    },
    logoText: {
      fontSize: '48px',
      fontWeight: 900,
      letterSpacing: '-0.025em',
      background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text'
    },
    tagline: {
      color: '#6b7280',
      fontSize: '10px',
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.2em',
      marginTop: '8px'
    },
    inputWrapper: {
      position: 'relative',
      marginBottom: '16px'
    },
    inputIcon: {
      position: 'absolute',
      top: '50%',
      left: '16px',
      transform: 'translateY(-50%)',
      color: '#6b7280'
    },
    input: {
      width: '100%',
      padding: '14px 16px 14px 44px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '12px',
      color: 'white',
      fontSize: '14px',
      outline: 'none',
      transition: 'all 0.3s ease',
      boxSizing: 'border-box'
    },
    inputPassword: {
      width: '100%',
      padding: '14px 48px 14px 44px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '12px',
      color: 'white',
      fontSize: '14px',
      outline: 'none',
      transition: 'all 0.3s ease',
      boxSizing: 'border-box'
    },
    eyeButton: {
      position: 'absolute',
      top: '50%',
      right: '16px',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      color: '#6b7280',
      cursor: 'pointer',
      padding: '4px'
    },
    loginButton: {
      width: '100%',
      padding: '14px',
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      border: 'none',
      borderRadius: '12px',
      color: 'white',
      fontSize: '16px',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      boxShadow: '0 4px 20px rgba(59,130,246,0.25)',
      marginTop: '8px'
    },
    switchButton: {
      width: '100%',
      textAlign: 'center',
      background: 'none',
      border: 'none',
      color: '#6b7280',
      fontSize: '14px',
      cursor: 'pointer',
      padding: '12px',
      transition: 'color 0.3s ease'
    },
    footer: {
      textAlign: 'center',
      color: '#4b5563',
      fontSize: '10px',
      letterSpacing: '0.2em',
      marginTop: '24px'
    },
    toastContainer: {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 9999,
      padding: '16px 24px',
      borderRadius: '16px',
      background: 'rgba(10,15,30,0.95)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      maxWidth: '400px',
      animation: 'slideIn 0.4s ease-out'
    },
    toastSuccess: {
      borderLeft: '4px solid #34d399'
    },
    toastError: {
      borderLeft: '4px solid #f43f5e'
    },
    toastInfo: {
      borderLeft: '4px solid #3b82f6'
    },
    userBadge: {
      background: 'rgba(59,130,246,0.1)',
      border: '1px solid rgba(59,130,246,0.2)',
      borderRadius: '12px',
      padding: '16px',
      textAlign: 'center',
      marginBottom: '20px'
    },
    userLabel: {
      color: '#6b7280',
      fontSize: '10px',
      marginBottom: '4px'
    },
    userName: {
      color: '#60a5fa',
      fontSize: '18px',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px'
    },
    dot: {
      width: '8px',
      height: '8px',
      background: '#34d399',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'pulse 2s infinite'
    },
    label: {
      color: '#6b7280',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      display: 'block',
      marginBottom: '8px'
    },
    joinRow: {
      display: 'flex',
      gap: '8px'
    },
    joinInput: {
      flex: 1,
      padding: '12px 16px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '12px',
      color: 'white',
      fontSize: '14px',
      outline: 'none',
      transition: 'all 0.3s ease'
    },
    joinButton: {
      padding: '12px 24px',
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      border: 'none',
      borderRadius: '12px',
      color: 'white',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      boxShadow: '0 4px 20px rgba(59,130,246,0.2)',
      whiteSpace: 'nowrap'
    },
    divider: {
      position: 'relative',
      padding: '16px 0',
      textAlign: 'center'
    },
    dividerLine: {
      position: 'absolute',
      top: '50%',
      left: 0,
      right: 0,
      height: '1px',
      background: 'rgba(255,255,255,0.1)'
    },
    dividerText: {
      position: 'relative',
      display: 'inline-block',
      background: '#0a0f1e',
      padding: '0 12px',
      color: '#4b5563',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.1em'
    },
    createButton: {
      width: '100%',
      padding: '16px',
      background: 'rgba(16,185,129,0.15)',
      border: '1px solid rgba(16,185,129,0.3)',
      borderRadius: '12px',
      color: '#34d399',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px'
    },
    logoutButton: {
      width: '100%',
      padding: '8px',
      background: 'none',
      border: 'none',
      color: '#6b7280',
      fontSize: '12px',
      cursor: 'pointer',
      transition: 'color 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      marginTop: '16px',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      paddingTop: '16px'
    },
    space: { marginTop: '16px' }
  };

  return (
    <div style={styles.container}>
      {/* Background */}
      <div style={styles.bgBlur1}></div>
      <div style={styles.bgBlur2}></div>
      <div style={styles.bgBlur3}></div>

      {/* Toast */}
      {toast && (
        <div style={{ ...styles.toastContainer, ...(toast.type === 'success' ? styles.toastSuccess : toast.type === 'error' ? styles.toastError : styles.toastInfo) }}>
          <span style={{ color: 'white' }}>{toast.message}</span>
        </div>
      )}

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoContainer}>
          <div style={styles.logoBox}>
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <h1 style={styles.logoText}>NEXUS</h1>
          <p style={styles.tagline}>Connect • Collaborate • Create</p>
        </div>

        {!isLoggedIn ? (
          // Login/Signup
          <div>
            <div style={styles.inputWrapper}>
              <div style={styles.inputIcon}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>

            <div style={styles.inputWrapper}>
              <div style={styles.inputIcon}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.inputPassword}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>

            <button
              onClick={handleAuth}
              disabled={loading}
              style={{
                ...styles.loginButton,
                opacity: loading ? 0.5 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.target.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.target.style.background = 'linear-gradient(135deg, #3b82f6, #8b5cf6)';
                }
              }}
            >
              {loading ? (
                <span>⏳ Processing...</span>
              ) : (
                isSignup ? '🚀 Create Account' : '✨ Sign In'
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSignup(!isSignup);
                setPassword('');
              }}
              style={styles.switchButton}
              onMouseEnter={(e) => e.target.style.color = 'white'}
              onMouseLeave={(e) => e.target.style.color = '#6b7280'}
            >
              {isSignup ? 'Already a member? Login' : 'New here? Create an account'}
            </button>
          </div>
        ) : (
          // Dashboard
          <div>
            <div style={styles.userBadge}>
              <p style={styles.userLabel}>Authenticated as</p>
              <p style={styles.userName}>
                <span style={styles.dot}></span>
                {localStorage.getItem('username')}
              </p>
            </div>

            <div>
              <label style={styles.label}>Join Existing Room</label>
              <div style={styles.joinRow}>
                <input
                  type="text"
                  placeholder="Enter Room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  style={styles.joinInput}
                  onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                  onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
                <button 
                  onClick={joinRoom} 
                  style={styles.joinButton}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'linear-gradient(135deg, #3b82f6, #8b5cf6)';
                  }}
                >
                  Join
                </button>
              </div>
            </div>

            <div style={styles.divider}>
              <div style={styles.dividerLine}></div>
              <span style={styles.dividerText}>Or</span>
            </div>

            <button 
              onClick={createRoom} 
              style={styles.createButton}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(16,185,129,0.25)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'rgba(16,185,129,0.15)';
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
              Create Private Space
            </button>

            <button 
              onClick={handleLogout} 
              style={styles.logoutButton}
              onMouseEnter={(e) => e.target.style.color = '#f43f5e'}
              onMouseLeave={(e) => e.target.style.color = '#6b7280'}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* <p style={styles.footer}>🔒 End-to-End Encrypted · v2.0</p> */}
    </div>
  );
}

export default Home;