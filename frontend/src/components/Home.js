import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

function Home() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setTheme] = useState('aurora');
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const themePresets = {
    aurora: {
      label: 'Aurora',
      background: 'radial-gradient(circle at top left, rgba(96, 165, 250, 0.25), transparent 24%), radial-gradient(circle at bottom right, rgba(168, 85, 247, 0.2), transparent 28%), linear-gradient(135deg, #050816 0%, #0f172a 45%, #111827 100%)',
      blur1: 'rgba(59, 130, 246, 0.16)',
      blur2: 'rgba(168, 85, 247, 0.16)',
      blur3: 'rgba(16, 185, 129, 0.09)',
      accent1: '#3b82f6',
      accent2: '#8b5cf6',
      accent3: '#f472b6',
      chip: 'rgba(59, 130, 246, 0.14)',
      preview: 'linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(168, 85, 247, 0.12))',
      badge: 'rgba(59,130,246,0.12)',
      text: '#8dd3ff',
      muted: '#7c8aa5',
      surface: 'rgba(8, 15, 31, 0.78)'
    },
    glow: {
      label: 'Glow',
      background: 'radial-gradient(circle at top left, rgba(52, 211, 153, 0.22), transparent 24%), radial-gradient(circle at bottom right, rgba(34, 211, 238, 0.2), transparent 28%), linear-gradient(135deg, #02110f 0%, #0f172a 45%, #111827 100%)',
      blur1: 'rgba(52, 211, 153, 0.16)',
      blur2: 'rgba(34, 211, 238, 0.16)',
      blur3: 'rgba(56, 189, 248, 0.09)',
      accent1: '#34d399',
      accent2: '#22d3ee',
      accent3: '#38bdf8',
      chip: 'rgba(52, 211, 153, 0.16)',
      preview: 'linear-gradient(135deg, rgba(52, 211, 153, 0.18), rgba(34, 211, 238, 0.14))',
      badge: 'rgba(52,211,153,0.12)',
      text: '#86efac',
      muted: '#8ea2b8',
      surface: 'rgba(5, 20, 24, 0.78)'
    },
    sunset: {
      label: 'Sunset',
      background: 'radial-gradient(circle at top left, rgba(251, 191, 36, 0.22), transparent 24%), radial-gradient(circle at bottom right, rgba(244, 114, 182, 0.2), transparent 28%), linear-gradient(135deg, #1c1011 0%, #22141c 45%, #111827 100%)',
      blur1: 'rgba(251, 191, 36, 0.16)',
      blur2: 'rgba(244, 114, 182, 0.16)',
      blur3: 'rgba(249, 115, 22, 0.09)',
      accent1: '#fb923c',
      accent2: '#f472b6',
      accent3: '#f43f5e',
      chip: 'rgba(251, 191, 36, 0.16)',
      preview: 'linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(244, 114, 182, 0.14))',
      badge: 'rgba(251,191,36,0.12)',
      text: '#fbbf24',
      muted: '#bba8a5',
      surface: 'rgba(28, 16, 17, 0.78)'
    }
  };

  const activeTheme = themePresets[theme] || themePresets.aurora;

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
      padding: '24px',
      background: activeTheme.background,
      position: 'relative',
      overflow: 'hidden',
      animation: 'fadeIn 0.8s ease-out'
    },
    bgBlur1: {
      position: 'absolute',
      top: '-20%',
      left: '-10%',
      width: '44%',
      height: '44%',
      background: activeTheme.blur1,
      borderRadius: '50%',
      filter: 'blur(140px)',
      pointerEvents: 'none',
      animation: 'floatGlow 7s ease-in-out infinite'
    },
    bgBlur2: {
      position: 'absolute',
      bottom: '-18%',
      right: '-8%',
      width: '46%',
      height: '46%',
      background: activeTheme.blur2,
      borderRadius: '50%',
      filter: 'blur(140px)',
      pointerEvents: 'none',
      animation: 'floatGlow 8s ease-in-out infinite reverse'
    },
    bgBlur3: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '36%',
      height: '36%',
      background: activeTheme.blur3,
      borderRadius: '50%',
      filter: 'blur(120px)',
      pointerEvents: 'none',
      animation: 'floatGlow 9s ease-in-out infinite'
    },
    card: {
      position: 'relative',
      zIndex: 10,
      width: '100%',
      maxWidth: '1120px',
      background: 'rgba(8, 15, 31, 0.78)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '30px',
      padding: '28px',
      boxShadow: '0 24px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
      animation: 'slideUp 0.9s ease-out'
    },
    heroPanel: {
      padding: '22px 12px 22px 8px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '10px'
    },
    formPanel: {
      padding: '20px 18px',
      background: 'rgba(255,255,255,0.045)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: '24px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      transition: 'transform 0.3s ease, box-shadow 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    },
    eyebrow: {
      display: 'inline-flex',
      alignSelf: 'flex-start',
      padding: '7px 12px',
      borderRadius: '999px',
      background: activeTheme.chip,
      color: activeTheme.text,
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      marginBottom: '14px'
    },
    heroTitle: {
      fontSize: 'clamp(28px, 3.4vw, 42px)',
      lineHeight: 1.15,
      fontWeight: 800,
      color: '#f8fafc',
      marginBottom: '14px'
    },
    heroText: {
      fontSize: '15px',
      lineHeight: 1.7,
      color: '#94a3b8',
      maxWidth: '560px',
      marginBottom: '18px'
    },
    featureList: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      marginBottom: '18px'
    },
    featureChip: {
      padding: '8px 12px',
      borderRadius: '999px',
      background: 'rgba(255,255,255,0.05)',
      color: '#cbd5e1',
      border: '1px solid rgba(255,255,255,0.08)',
      fontSize: '12px',
      fontWeight: 600
    },
    previewCard: {
      marginTop: '8px',
      padding: '16px 18px',
      borderRadius: '20px',
      background: activeTheme.preview,
      border: '1px solid rgba(255,255,255,0.08)',
      transition: 'transform 0.3s ease, box-shadow 0.3s ease',
      boxShadow: '0 10px 30px rgba(2, 8, 23, 0.25)',
      maxWidth: '520px'
    },
    previewHeader: {
      color: '#e2e8f0',
      fontSize: '12px',
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
      opacity: 0.8,
      marginBottom: '10px'
    },
    previewBubble: {
      background: 'rgba(255,255,255,0.92)',
      color: '#0f172a',
      padding: '10px 12px',
      borderRadius: '14px',
      fontSize: '13px',
      boxShadow: '0 8px 20px rgba(15, 23, 42, 0.2)'
    },
    logoContainer: {
      textAlign: 'center',
      marginBottom: '24px'
    },
    logoBox: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '76px',
      height: '76px',
      borderRadius: '18px',
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      marginBottom: '14px',
      boxShadow: '0 0 40px rgba(59,130,246,0.28)',
      transition: 'transform 0.35s ease, box-shadow 0.35s ease'
    },
    logoText: {
      fontSize: '40px',
      fontWeight: 900,
      letterSpacing: '-0.03em',
      background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text'
    },
    tagline: {
      color: '#7c8aa5',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.24em',
      marginTop: '6px'
    },
    inputWrapper: {
      position: 'relative',
      marginBottom: '14px'
    },
    inputIcon: {
      position: 'absolute',
      top: '50%',
      left: '16px',
      transform: 'translateY(-50%)',
      color: '#7c8aa5'
    },
    input: {
      width: '100%',
      padding: '14px 16px 14px 44px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '14px',
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
      borderRadius: '14px',
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
      color: '#7c8aa5',
      cursor: 'pointer',
      padding: '4px'
    },
    loginButton: {
      width: '100%',
      padding: '14px',
      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      border: 'none',
      borderRadius: '14px',
      color: 'white',
      fontSize: '15px',
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      boxShadow: '0 10px 24px rgba(59,130,246,0.25)',
      marginTop: '8px',
      transform: 'translateY(0)',
      letterSpacing: '0.01em'
    },
    switchButton: {
      width: '100%',
      textAlign: 'center',
      background: 'none',
      border: 'none',
      color: '#7c8aa5',
      fontSize: '14px',
      cursor: 'pointer',
      padding: '12px',
      transition: 'color 0.3s ease, transform 0.3s ease',
      marginTop: '2px'
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
      background: activeTheme.badge,
      border: '1px solid rgba(59,130,246,0.2)',
      borderRadius: '14px',
      padding: '16px',
      textAlign: 'center',
      marginBottom: '18px',
      boxShadow: '0 8px 24px rgba(2, 8, 23, 0.16)'
    },
    userLabel: {
      color: '#7c8aa5',
      fontSize: '10px',
      marginBottom: '4px'
    },
    userName: {
      color: activeTheme.text,
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
      color: '#7c8aa5',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.16em',
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
      background: 'rgba(8, 15, 31, 0.78)',
      padding: '0 12px',
      color: '#64748b',
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.16em'
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
      gap: '8px',
      transform: 'translateY(0)'
    },
    logoutButton: {
      width: '100%',
      padding: '8px',
      background: 'none',
      border: 'none',
      color: '#7c8aa5',
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
    space: { marginTop: '16px' },
    themeRow: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginBottom: '14px'
    },
    themeButton: {
      padding: '7px 10px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(255,255,255,0.04)',
      color: '#cbd5e1',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: 700,
      transition: 'all 0.25s ease'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.bgBlur1}></div>
      <div style={styles.bgBlur2}></div>
      <div style={styles.bgBlur3}></div>

      {toast && (
        <div style={{ ...styles.toastContainer, ...(toast.type === 'success' ? styles.toastSuccess : toast.type === 'error' ? styles.toastError : styles.toastInfo) }}>
          <span style={{ color: 'white' }}>{toast.message}</span>
        </div>
      )}

      <div style={styles.card} className="home-card">
        <div style={styles.heroPanel}>
          <div style={styles.eyebrow}>Secure collaboration hub</div>
          <h2 style={styles.heroTitle}>Chat, create & collaborate in a space that feels effortless.</h2>
          <p style={styles.heroText}>
            Join private rooms, share ideas instantly, and keep every conversation flowing with a polished real-time experience.
          </p>
          <div style={styles.themeRow}>
            {Object.entries(themePresets).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                style={{
                  ...styles.themeButton,
                  background: theme === key ? `linear-gradient(135deg, ${preset.accent1}, ${preset.accent2})` : 'rgba(255,255,255,0.04)',
                  color: theme === key ? 'white' : '#cbd5e1',
                  borderColor: theme === key ? 'transparent' : 'rgba(255,255,255,0.1)'
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div style={styles.featureList}>
            {['Realtime rooms', 'Private access', 'Smart notifications'].map((item) => (
              <span key={item} style={styles.featureChip}>{item}</span>
            ))}
          </div>
          <div style={styles.previewCard}>
            <div style={styles.previewHeader}>Live room preview</div>
            <div style={styles.previewBubble}>“The new workspace feels amazing — let’s build something great together.”</div>
          </div>
        </div>

        <div style={styles.formPanel}>
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
                onMouseEnter={(e) => e.target.style.color = '#f8fafc'}
                onMouseLeave={(e) => e.target.style.color = '#7c8aa5'}
              >
                {isSignup ? 'Already a member? Login' : 'New here? Create an account'}
              </button>
            </div>
          ) : (
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
                onMouseLeave={(e) => e.target.style.color = '#7c8aa5'}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Home;