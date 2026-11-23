import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import TicTacToeGame from './TicTacToeGame';
import './DirectMessages.css';

const backendURL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

function getInitials(username = '?') {
  return username.slice(0, 2).toUpperCase();
}

function formatFileSize(size) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageMedia({ conversationId, media, token }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl;
    axios.get(`${backendURL}${media.url}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob'
    }).then(response => {
      createdUrl = URL.createObjectURL(response.data);
      if (cancelled) {
        URL.revokeObjectURL(createdUrl);
      } else {
        setObjectUrl(createdUrl);
      }
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [conversationId, media.url, token]);

  if (loadError) {
    return <span className="dm-media-status">Attachment could not be loaded.</span>;
  }
  if (!objectUrl) {
    return <span className="dm-media-status">Loading attachment…</span>;
  }
  if (media.mediaType === 'image') {
    return <img className="dm-attachment-image" src={objectUrl} alt={media.fileName} />;
  }
  if (media.mediaType === 'video') {
    return (
      <video className="dm-attachment-video" src={objectUrl} controls preload="metadata">
        Your browser does not support video playback.
      </video>
    );
  }
  return (
    <a className="dm-attachment-document" href={objectUrl} download={media.fileName}>
      <span className="dm-document-icon" aria-hidden="true">▤</span>
      <span className="dm-document-name">{media.fileName}</span>
      <span className="dm-document-size">{formatFileSize(media.size)} · Download</span>
    </a>
  );
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function DirectMessages() {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || 'You';
  const token = localStorage.getItem('token');
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [showPeople, setShowPeople] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [privacyHidden, setPrivacyHidden] = useState(false);
  const [typingUser, setTypingUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [sending, setSending] = useState(false);
  const [showGame, setShowGame] = useState(false);
  const [error, setError] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const socketRef = useRef(null);
  const activeConversationRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  activeConversationRef.current = activeConversation;

  const authConfig = useCallback(() => ({
    headers: { Authorization: `Bearer ${token}` }
  }), [token]);

  const loadConversations = useCallback(async () => {
    const response = await axios.get(`${backendURL}/api/conversations`, authConfig());
    setConversations(response.data.conversations);
    return response.data.conversations;
  }, [authConfig]);

  const mergeMessages = (previous, incoming) => {
    const byId = new Map(previous.map(message => [message.id, message]));
    incoming.forEach(message => byId.set(message.id, message));
    return Array.from(byId.values()).sort(
      (left, right) => new Date(left.createdAt) - new Date(right.createdAt)
    );
  };

  useEffect(() => {
    if (!token) {
      navigate('/', { replace: true });
      return undefined;
    }

    let mounted = true;
    const socket = io(backendURL, {
      autoConnect: false,
      auth: { token }
    });
    socketRef.current = socket;

    const handleDirectMessage = ({ conversationId, message }) => {
      setConversations(previous => previous.map(conversation => (
        conversation.id === conversationId
          ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
          : conversation
      )));

      if (activeConversationRef.current?.id === conversationId) {
        setMessages(previous => mergeMessages(previous, [message]));
      }
    };

    const handleInboxMessage = ({ conversationId, message }) => {
      setConversations(previous => previous.map(conversation => (
        conversation.id === conversationId
          ? { ...conversation, lastMessage: message, updatedAt: message.createdAt }
          : conversation
      )));
      loadConversations().catch(loadError => {
        setError(loadError.response?.data?.error || 'Unable to refresh conversations.');
      });
    };

    const handleTyping = ({ conversationId, username: typingUsername }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setTypingUser(typingUsername);
      }
    };

    const handleStopTyping = ({ conversationId }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setTypingUser('');
      }
    };

    const handleConnect = () => {
      setError('');
      const conversationId = activeConversationRef.current?.id;
      if (conversationId) {
        socket.emit('join-conversation', { conversationId }, response => {
          if (response?.error) {
            setError(response.error);
            return;
          }
          setMessages(previous => mergeMessages(previous, response?.messages || []));
        });
      }
    };

    socket.on('direct-message', handleDirectMessage);
    socket.on('inbox-message', handleInboxMessage);
    socket.on('direct-typing', handleTyping);
    socket.on('direct-stop-typing', handleStopTyping);
    socket.on('connect', handleConnect);
    socket.on('connect_error', () => {
      setError('Could not connect to chat. Check that the server is running.');
    });
    socket.connect();

    loadConversations()
      .then(items => {
        if (mounted && items.length) {
          setActiveConversation(items[0]);
          setMobileChatOpen(true);
        }
      })
      .catch(loadError => {
        if (mounted) {
          setError(loadError.response?.data?.error || 'Unable to load conversations.');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadConversations, navigate, token]);

  useEffect(() => {
    if (!showPeople || !token) {
      setPeople([]);
      return undefined;
    }

    let cancelled = false;
    setLoadingPeople(true);
    const timeout = setTimeout(() => {
      axios.get(`${backendURL}/api/users`, {
        ...authConfig(),
        params: { q: search.trim() }
      })
        .then(response => {
          if (!cancelled) setPeople(response.data.users);
        })
        .catch(loadError => {
          if (!cancelled) {
            setError(loadError.response?.data?.error || 'Unable to search people.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingPeople(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [authConfig, search, showPeople, token]);

  useEffect(() => {
    if (!activeConversation) {
      setMessages([]);
      return undefined;
    }

    let cancelled = false;
    const conversationId = activeConversation.id;
    setMessages([]);
    setTypingUser('');

    axios.get(
      `${backendURL}/api/conversations/${conversationId}/messages`,
      authConfig()
    ).then(response => {
      if (!cancelled) {
        setMessages(previous => mergeMessages(previous, response.data.messages));
      }
    }).catch(loadError => {
      if (!cancelled) {
        setError(loadError.response?.data?.error || 'Unable to load messages.');
      }
    });

    const socket = socketRef.current;
    const join = () => {
      socket.emit('join-conversation', { conversationId }, response => {
        if (cancelled) return;
        if (response?.error) {
          setError(response.error);
          return;
        }
        setMessages(previous => mergeMessages(previous, response?.messages || []));
      });
    };

    if (socket?.connected) {
      join();
    }

    return () => {
      cancelled = true;
      socket?.emit('leave-conversation', { conversationId });
    };
  }, [activeConversation, authConfig]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const togglePrivacyScreen = useCallback(() => {
    if (!privacyHidden) {
      document.activeElement?.blur();
      setShowGame(false);
      setError('');
    }
    setPrivacyHidden(!privacyHidden);
  }, [privacyHidden]);

  useEffect(() => {
    const handlePrivacyShortcut = event => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        togglePrivacyScreen();
      }
    };

    window.addEventListener('keydown', handlePrivacyShortcut);
    return () => window.removeEventListener('keydown', handlePrivacyShortcut);
  }, [togglePrivacyScreen]);

  const openConversation = conversation => {
    setError('');
    setActiveConversation(conversation);
    setDraft('');
    setSelectedFile(null);
    setShowGame(false);
    setShowPeople(false);
    setSearch('');
    setMobileChatOpen(true);
  };

  const closeConversation = () => {
    setActiveConversation(null);
    setMessages([]);
    setTypingUser('');
    setDraft('');
    setSelectedFile(null);
    setShowGame(false);
    setMobileChatOpen(false);
    setError('');
  };

  const startConversation = async person => {
    setError('');
    try {
      const response = await axios.post(
        `${backendURL}/api/conversations`,
        { username: person.username },
        authConfig()
      );
      const conversation = response.data;
      setConversations(previous => [
        conversation,
        ...previous.filter(item => item.id !== conversation.id)
      ]);
      openConversation(conversation);
    } catch (startError) {
      setError(startError.response?.data?.error || 'Unable to start conversation.');
    }
  };

  const sendMessage = async event => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !selectedFile) || !activeConversation || sending) return;

    const socket = socketRef.current;
    if (!selectedFile && !socket?.connected) {
      setError('Chat is offline. Reconnect and try again.');
      return;
    }

    setSending(true);
    if (selectedFile) {
      const formData = new FormData();
      formData.append('media', selectedFile);
      formData.append('text', text);
      try {
        const response = await axios.post(
          `${backendURL}/api/conversations/${activeConversation.id}/media`,
          formData,
          {
            ...authConfig(),
            onUploadProgress: progressEvent => {
              if (progressEvent.total) {
                setUploadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
              }
            }
          }
        );
        setDraft('');
        setSelectedFile(null);
        setUploadProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (socket?.connected) {
          socket.emit('stop-typing-direct', { conversationId: activeConversation.id });
        }
        if (response.data?.message) {
          setMessages(previous => mergeMessages(previous, [response.data.message]));
        }
      } catch (uploadError) {
        const status = uploadError.response?.status;
        setError(
          uploadError.response?.data?.error
          || (status === 404
            ? 'The upload endpoint is unavailable. Restart the backend and try again.'
            : status
              ? `Unable to send attachment (server error ${status}).`
              : `Unable to reach the server: ${uploadError.message}`)
        );
      } finally {
        setSending(false);
        setUploadProgress(0);
      }
      return;
    }

    socket.emit('send-direct-message', {
      conversationId: activeConversation.id,
      text
    }, response => {
      setSending(false);
      if (response?.error) {
        setError(response.error);
        return;
      }
      setDraft('');
      socket.emit('stop-typing-direct', { conversationId: activeConversation.id });
      if (response?.message) {
        setMessages(previous => mergeMessages(previous, [response.message]));
      }
    });
  };

  const handleDraftChange = event => {
    const value = event.target.value;
    setDraft(value);
    if (!activeConversation || !socketRef.current?.connected) return;

    socketRef.current.emit('typing-direct', {
      conversationId: activeConversation.id
    });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit('stop-typing-direct', {
        conversationId: activeConversation.id
      });
    }, 1200);
  };

  const signOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    navigate('/', { replace: true });
  };

  return (
    <main className={`dm-page ${privacyHidden ? 'is-privacy-hidden' : ''}`}>
      <header className="dm-topbar">
        <button className="dm-brand" onClick={() => navigate('/')} aria-label="Nexus home">
          <span className="dm-brand-mark">N</span>
          <span>NEXUS</span>
        </button>
        <div className="dm-topbar-actions">
          <button
            type="button"
            className="dm-privacy-toggle"
            onClick={togglePrivacyScreen}
            aria-pressed={privacyHidden}
            aria-label={privacyHidden ? 'Reveal chat content' : 'Hide chat content'}
            title="Privacy screen (Alt+Shift+P)"
          >
            <span aria-hidden="true">{privacyHidden ? '◉' : '◌'}</span>
            <span>{privacyHidden ? 'Reveal' : 'Hide'}</span>
          </button>
          <span className="dm-account" aria-hidden={privacyHidden}><span className="dm-account-avatar">{getInitials(username)}</span>{username}</span>
          <button className="dm-signout" onClick={signOut}>Sign out</button>
        </div>
      </header>

      {error && (
        <div className="dm-error" role="alert" aria-hidden={privacyHidden}>
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error">×</button>
        </div>
      )}

      <section
        className={`dm-layout ${mobileChatOpen ? 'dm-mobile-chat-open' : ''}`}
        aria-hidden={privacyHidden}
      >
        <aside className="dm-sidebar">
          <div className="dm-sidebar-heading">
            <div>
              <span className="dm-overline">YOUR SPACE</span>
              <h1>Messages</h1>
            </div>
            <button
              className="dm-new-chat"
              onClick={() => {
                setShowPeople(value => !value);
                setSearch('');
              }}
              aria-expanded={showPeople}
              aria-label={showPeople ? 'Close new conversation search' : 'Start a new conversation'}
            >
              {showPeople ? '×' : '+'}
            </button>
          </div>

          <label className="dm-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              onFocus={() => setShowPeople(true)}
              placeholder="Find someone..."
              aria-label="Find people"
            />
            {search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}
          </label>

          {showPeople ? (
            <div className="dm-list-section">
              <div className="dm-list-label">{search ? 'SEARCH RESULTS' : 'PEOPLE ON NEXUS'}</div>
              {loadingPeople ? (
                <p className="dm-list-message">Finding people…</p>
              ) : people.length ? people.map(person => (
                <button
                  className="dm-person-row"
                  key={person.username}
                  onClick={() => startConversation(person)}
                >
                  <span className="dm-avatar">{getInitials(person.username)}</span>
                  <span className="dm-person-info">
                    <strong>{person.username}</strong>
                    <small>{person.isOnline ? 'Online now' : 'Start a conversation'}</small>
                  </span>
                  <span className={`dm-presence ${person.isOnline ? 'is-online' : ''}`} />
                </button>
              )) : (
                <p className="dm-list-message">
                  {search ? 'No people match that name.' : 'No other people have joined yet.'}
                </p>
              )}
            </div>
          ) : (
            <div className="dm-list-section">
              <div className="dm-list-label">RECENT CONVERSATIONS</div>
              {loading ? (
                <p className="dm-list-message">Loading your inbox…</p>
              ) : conversations.length ? conversations.map(conversation => (
                <button
                  className={`dm-conversation-row ${activeConversation?.id === conversation.id ? 'is-active' : ''}`}
                  key={conversation.id}
                  onClick={() => openConversation(conversation)}
                >
                  <span className="dm-avatar">{getInitials(conversation.otherUser?.username)}</span>
                  <span className="dm-conversation-info">
                    <strong>{conversation.otherUser?.username || 'Nexus user'}</strong>
                    <small>{conversation.lastMessage?.text || 'Start your conversation'}</small>
                  </span>
                  <span className="dm-conversation-meta">
                    <time>{formatTime(conversation.lastMessage?.createdAt || conversation.updatedAt)}</time>
                    {conversation.otherUser?.isOnline && <span className="dm-presence is-online" />}
                  </span>
                </button>
              )) : (
                <div className="dm-empty-list">
                  <span className="dm-empty-icon">✳</span>
                  <strong>Your inbox is ready</strong>
                  <p>Find someone on Nexus to start a private conversation.</p>
                  <button onClick={() => setShowPeople(true)}>Find people</button>
                </div>
              )}
            </div>
          )}

          <div className="dm-sidebar-footer">
            <span className="dm-lock">◆</span>
            Private one-to-one conversations
          </div>
        </aside>

        <section className="dm-chat-panel" aria-label="Conversation">
          {activeConversation ? (
            <>
              <header className="dm-chat-header">
                <button
                  className="dm-back-button"
                  onClick={closeConversation}
                  aria-label="Close chat and return to conversations"
                >
                  ‹
                </button>
                <span className="dm-avatar dm-avatar-large">
                  {getInitials(activeConversation.otherUser?.username)}
                </span>
                <div className="dm-chat-contact">
                  <strong>{activeConversation.otherUser?.username || 'Nexus user'}</strong>
                  <span>
                    <i className={`dm-presence ${activeConversation.otherUser?.isOnline ? 'is-online' : ''}`} />
                    {activeConversation.otherUser?.isOnline ? 'Online' : 'Private conversation'}
                  </span>
                </div>
                <button
                  type="button"
                  className="dm-open-game"
                  onClick={() => setShowGame(true)}
                  aria-label="Play tic-tac-toe"
                >
                  <span aria-hidden="true">✕</span>
                  <span>Play game</span>
                </button>
                <span className="dm-private-badge"><span>◆</span> PRIVATE</span>
                <button
                  type="button"
                  className="dm-close-chat"
                  onClick={closeConversation}
                  aria-label="Close this chat and return to conversations"
                  title="Close chat"
                >
                  <span aria-hidden="true">×</span>
                  Close chat
                </button>
              </header>

              <div className="dm-message-list">
                {messages.length ? messages.map(message => {
                  const isOwn = message.username === username;
                  return (
                    <div className={`dm-message-row ${isOwn ? 'is-own' : ''}`} key={message.id}>
                      {!isOwn && <span className="dm-avatar dm-message-avatar">{getInitials(message.username)}</span>}
                      <div className="dm-message-content">
                        {!isOwn && <span className="dm-message-author">{message.username}</span>}
                        <div className={`dm-bubble ${message.media ? 'dm-bubble-with-media' : ''}`}>
                          {message.media && (
                            <MessageMedia
                              conversationId={activeConversation.id}
                              media={message.media}
                              token={token}
                            />
                          )}
                          {message.text && (
                            <span className={message.media ? 'dm-message-caption' : ''}>
                              {message.text}
                            </span>
                          )}
                        </div>
                        <time>{formatTime(message.createdAt)}</time>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="dm-chat-empty">
                    <span className="dm-chat-empty-icon">✳</span>
                    <h2>This is the beginning</h2>
                    <p>Send a message to {activeConversation.otherUser?.username} and get the conversation going.</p>
                  </div>
                )}
                {typingUser && <div className="dm-typing">{typingUser} is typing<span>…</span></div>}
                <div ref={messagesEndRef} />
              </div>

              <form className="dm-composer" onSubmit={sendMessage}>
                {selectedFile && (
                  <div className="dm-selected-file">
                    <span aria-hidden="true">📎</span>
                    <span className="dm-selected-file-name">{selectedFile.name}</span>
                    <span>{formatFileSize(selectedFile.size)}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      aria-label={`Remove ${selectedFile.name}`}
                      disabled={sending}
                    >
                      ×
                    </button>
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={handleDraftChange}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage(event);
                    }
                  }}
                  placeholder={`Message ${activeConversation.otherUser?.username || ''}…`}
                  aria-label="Write a message"
                  maxLength={4000}
                  rows={1}
                />
                <div className="dm-composer-bottom">
                  <div className="dm-composer-tools">
                    <input
                      ref={fileInputRef}
                      className="dm-file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        if (file.size > MAX_ATTACHMENT_SIZE) {
                          setError('Attachments must be 20 MB or smaller.');
                          return;
                        }
                        setError('');
                        setSelectedFile(file);
                      }}
                    />
                    <button
                      className="dm-attach-button"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending}
                      aria-label="Attach an image, video, or document"
                      title="Attach image, video, or document (max 20 MB)"
                    >
                      <span aria-hidden="true">＋</span> Attach
                    </button>
                    <span>Enter to send · Shift + Enter for a new line</span>
                  </div>
                  <button type="submit" disabled={(!draft.trim() && !selectedFile) || sending}>
                    {sending ? (selectedFile ? `Uploading ${uploadProgress}%…` : 'Sending…') : 'Send'}
                    <span aria-hidden="true">↑</span>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="dm-welcome">
              <div className="dm-welcome-orbit"><span>✳</span></div>
              <span className="dm-overline">GOOD TO SEE YOU, {username.toUpperCase()}</span>
              <h2>Make room for<br /><em>a real conversation.</em></h2>
              <p>Choose a conversation or find someone to start a private chat.</p>
              <button onClick={() => setShowPeople(true)}>Start a conversation <span>→</span></button>
            </div>
          )}
        </section>
      </section>
      {showGame && activeConversation && (
        <TicTacToeGame
          conversationId={activeConversation.id}
          socket={socketRef.current}
          username={username}
          onClose={() => setShowGame(false)}
        />
      )}
      {privacyHidden && (
        <div className="dm-privacy-overlay" role="dialog" aria-modal="true" aria-labelledby="dm-privacy-title">
          <div className="dm-privacy-card">
            <span className="dm-privacy-icon" aria-hidden="true">◉</span>
            <h2 id="dm-privacy-title">Privacy screen is on</h2>
            <p>Your chats and game are hidden from view.</p>
            <button type="button" onClick={togglePrivacyScreen}>Reveal chat</button>
            <span className="dm-privacy-shortcut">Press Alt + Shift + P to toggle</span>
          </div>
        </div>
      )}
    </main>
  );
}

export default DirectMessages;
