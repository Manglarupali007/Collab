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
  if (media.mediaType === 'audio') {
    return <audio className="dm-attachment-audio" src={objectUrl} controls preload="metadata" />;
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
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const socketRef = useRef(null);
  const activeConversationRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);

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
        setConversations(previous => previous.map(conversation => (
          conversation.id === conversationId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )));
        socket.emit('mark-direct-read', { conversationId }, response => {
          if (response?.error) {
            setError(response.error);
            return;
          }
          setConversations(previous => previous.map(conversation => (
            conversation.id === conversationId
              ? { ...conversation, unreadCount: 0 }
              : conversation
          )));
        });
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

    const handleDirectReaction = ({ conversationId, messageId, reactions }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setMessages(previous => previous.map(message => (
          message.id === messageId ? { ...message, reactions } : message
        )));
      }
      setReactionPickerMessageId(null);
    };

    const handleDirectMessageUpdated = ({ conversationId, message }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setMessages(previous => mergeMessages(previous, [message]));
      }
    };

    const handleConversationPreviewUpdated = ({ conversationId, lastMessage, updatedAt }) => {
      setConversations(previous => previous.map(conversation => (
        conversation.id === conversationId
          ? { ...conversation, lastMessage, updatedAt }
          : conversation
      )));
    };

    const handleDirectReadReceipt = ({ conversationId, readerId, readAt }) => {
      if (activeConversationRef.current?.id !== conversationId) return;
      setMessages(previous => previous.map(message => (
        message.senderId !== readerId && new Date(message.createdAt) <= new Date(readAt)
          ? { ...message, readBy: Array.from(new Set([...(message.readBy || []), readerId])) }
          : message
      )));
    };

    const handleDirectPinsUpdated = ({ conversationId, pinnedMessages: updatedPins }) => {
      if (activeConversationRef.current?.id === conversationId) {
        setPinnedMessages(updatedPins || []);
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
          setPinnedMessages(response?.pinnedMessages || []);
          socket.emit('mark-direct-read', { conversationId }, readResponse => {
            if (readResponse?.error) {
              setError(readResponse.error);
              return;
            }
            setConversations(previous => previous.map(conversation => (
              conversation.id === conversationId
                ? { ...conversation, unreadCount: 0 }
                : conversation
            )));
          });
        });
      }
    };

    socket.on('direct-message', handleDirectMessage);
    socket.on('inbox-message', handleInboxMessage);
    socket.on('direct-typing', handleTyping);
    socket.on('direct-stop-typing', handleStopTyping);
    socket.on('direct-reaction', handleDirectReaction);
    socket.on('direct-message-updated', handleDirectMessageUpdated);
    socket.on('conversation-preview-updated', handleConversationPreviewUpdated);
    socket.on('direct-read-receipt', handleDirectReadReceipt);
    socket.on('direct-pins-updated', handleDirectPinsUpdated);
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
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      recordingStreamRef.current?.getTracks().forEach(track => track.stop());
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
        setPinnedMessages(response.data.pinnedMessages || []);
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
        setPinnedMessages(response?.pinnedMessages || []);
        socket.emit('mark-direct-read', { conversationId }, readResponse => {
          if (readResponse?.error) {
            setError(readResponse.error);
            return;
          }
          setConversations(previous => previous.map(conversation => (
            conversation.id === conversationId
              ? { ...conversation, unreadCount: 0 }
              : conversation
          )));
        });
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
    setReplyTarget(null);
    setSearchTerm('');
    setSearchResults(null);
    setPinnedMessages([]);
    setReactionPickerMessageId(null);
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
    setReplyTarget(null);
    setSearchTerm('');
    setSearchResults(null);
    setPinnedMessages([]);
    setShowGame(false);
    setReactionPickerMessageId(null);
    setMobileChatOpen(false);
    setError('');
  };

  const addDirectReaction = (messageId, emoji) => {
    const socket = socketRef.current;
    if (!activeConversation) return;
    if (!socket?.connected) {
      setError('Chat is offline. Reconnect before adding a reaction.');
      return;
    }

    const message = messages.find(item => item.id === messageId);
    const previousReactions = message?.reactions || {};
    const updatedReactions = {
      ...previousReactions,
      [emoji]: (previousReactions[emoji] || 0) + 1
    };
    setMessages(previous => previous.map(item => (
      item.id === messageId ? { ...item, reactions: updatedReactions } : item
    )));
    setReactionPickerMessageId(null);

    socket.timeout(5000).emit('react-to-direct-message', {
      conversationId: activeConversation.id,
      messageId,
      emoji
    }, (timeoutError, response) => {
      if (timeoutError || response?.error) {
        setMessages(previous => previous.map(item => (
          item.id === messageId ? { ...item, reactions: previousReactions } : item
        )));
        setError(response?.error || 'Reaction could not be sent. Check the chat connection.');
        return;
      }
      if (response?.reactions) {
        setMessages(previous => previous.map(message => (
          message.id === messageId
            ? { ...message, reactions: response.reactions }
            : message
        )));
      }
    });
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
      if (replyTarget) formData.append('replyToId', replyTarget.id);
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
        setReplyTarget(null);
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
      text,
      replyToId: replyTarget?.id
    }, response => {
      setSending(false);
      if (response?.error) {
        setError(response.error);
        return;
      }
      setDraft('');
      setReplyTarget(null);
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

  const searchMessages = async event => {
    event.preventDefault();
    const query = searchTerm.trim();
    if (!activeConversation || !query) {
      setSearchResults(null);
      return;
    }

    try {
      const response = await axios.get(
        `${backendURL}/api/conversations/${activeConversation.id}/messages`,
        { ...authConfig(), params: { q: query } }
      );
      setSearchResults(response.data.messages || []);
    } catch (searchError) {
      setError(searchError.response?.data?.error || 'Unable to search this conversation.');
    }
  };

  const openSearchResult = message => {
    setMessages(previous => mergeMessages(previous, [message]));
    setSearchResults(null);
    setSearchTerm('');
    setTimeout(() => {
      document.getElementById(`dm-message-${message.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 50);
  };

  const togglePin = messageId => {
    const socket = socketRef.current;
    if (!socket?.connected || !activeConversation) {
      setError('Chat is offline. Reconnect before updating pinned messages.');
      return;
    }
    socket.timeout(5000).emit('toggle-direct-pin', {
      conversationId: activeConversation.id,
      messageId
    }, (timeoutError, response) => {
      if (timeoutError || response?.error) {
        setError(response?.error || 'Unable to update pinned messages.');
        return;
      }
      setPinnedMessages(response.pinnedMessages || []);
    });
  };

  const editMessage = message => {
    const editedText = window.prompt('Edit your message:', message.text);
    if (editedText === null || editedText.trim() === message.text) return;
    const socket = socketRef.current;
    if (!socket?.connected || !activeConversation) {
      setError('Chat is offline. Reconnect before editing messages.');
      return;
    }
    socket.timeout(5000).emit('edit-direct-message', {
      conversationId: activeConversation.id,
      messageId: message.id,
      text: editedText
    }, (timeoutError, response) => {
      if (timeoutError || response?.error) {
        setError(response?.error || 'Unable to edit message.');
        return;
      }
      if (response?.message) {
        setMessages(previous => mergeMessages(previous, [response.message]));
      }
    });
  };

  const deleteMessage = messageId => {
    if (!window.confirm('Delete this message? It will be replaced with a deleted-message notice.')) {
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected || !activeConversation) {
      setError('Chat is offline. Reconnect before deleting messages.');
      return;
    }
    socket.timeout(5000).emit('delete-direct-message', {
      conversationId: activeConversation.id,
      messageId
    }, (timeoutError, response) => {
      if (timeoutError || response?.error) {
        setError(response?.error || 'Unable to delete message.');
        return;
      }
      if (response?.message) {
        setMessages(previous => mergeMessages(previous, [response.message]));
      }
    });
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported by this browser.');
      return;
    }
    if (!MediaRecorder.isTypeSupported('audio/webm')) {
      setError('This browser cannot record the supported audio format.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError('Voice recording failed. Check microphone permissions and try again.');
        setIsRecording(false);
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        if (!blob.size) return;
        if (blob.size > MAX_ATTACHMENT_SIZE) {
          setError('Voice notes must be 20 MB or smaller.');
          return;
        }
        setError('');
        setSelectedFile(new File([blob], `voice-note-${Date.now()}.webm`, {
          type: 'audio/webm'
        }));
      };
      recorder.start();
      setIsRecording(true);
      setError('');
    } catch (recordingError) {
      setError(recordingError.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access and try again.'
        : 'Unable to start voice recording.');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
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
                    {conversation.unreadCount > 0 && (
                      <span className="dm-unread-count" aria-label={`${conversation.unreadCount} unread messages`}>
                        {conversation.unreadCount}
                      </span>
                    )}
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
                <button
                  type="button"
                  className="dm-chat-search-toggle"
                  onClick={() => document.getElementById('dm-chat-search')?.focus()}
                  aria-label="Search this conversation"
                  title="Search messages"
                >
                  Search
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

              <form className="dm-search-form" onSubmit={searchMessages}>
                <input
                  id="dm-chat-search"
                  value={searchTerm}
                  onChange={event => {
                    setSearchTerm(event.target.value);
                    if (!event.target.value) setSearchResults(null);
                  }}
                  placeholder="Search messages and files…"
                  aria-label="Search messages and shared files"
                />
                <button type="submit">Search</button>
                {searchResults !== null && (
                  <button
                    type="button"
                    className="dm-search-clear"
                    onClick={() => {
                      setSearchResults(null);
                      setSearchTerm('');
                    }}
                    aria-label="Clear search results"
                  >
                    ×
                  </button>
                )}
                {searchResults !== null && (
                  <div className="dm-search-results">
                    {searchResults.length ? searchResults.map(result => (
                      <button
                        type="button"
                        key={result.id}
                        onClick={() => openSearchResult(result)}
                      >
                        <strong>{result.username}</strong>
                        <span>{result.media?.fileName || result.text}</span>
                        <time>{formatTime(result.createdAt)}</time>
                      </button>
                    )) : <p>No matching messages or files.</p>}
                  </div>
                )}
              </form>

              {pinnedMessages.length > 0 && (
                <div className="dm-pinned-list" aria-label="Pinned messages">
                  <strong>PINNED</strong>
                  {pinnedMessages.map(message => (
                    <button
                      type="button"
                      key={message.id}
                      onClick={() => openSearchResult(message)}
                      title={`${message.username}: ${message.text || message.media?.fileName || 'Attachment'}`}
                    >
                      <span>{message.text || message.media?.fileName || 'Attachment'}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="dm-message-list">
                {messages.length ? messages.map(message => {
                  const isOwn = message.username === username;
                  const isPinned = pinnedMessages.some(pin => pin.id === message.id);
                  return (
                    <div
                      className={`dm-message-row ${isOwn ? 'is-own' : ''}`}
                      key={message.id}
                      id={`dm-message-${message.id}`}
                    >
                      {!isOwn && <span className="dm-avatar dm-message-avatar">{getInitials(message.username)}</span>}
                      <div className="dm-message-content">
                        {!isOwn && <span className="dm-message-author">{message.username}</span>}
                        {message.replyTo && (
                          <button
                            type="button"
                            className="dm-reply-preview"
                            onClick={() => document.getElementById(`dm-message-${message.replyTo.messageId}`)?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'center'
                            })}
                          >
                            <strong>{message.replyTo.username}</strong>
                            <span>{message.replyTo.text}</span>
                          </button>
                        )}
                        <div className={`dm-bubble ${message.media ? 'dm-bubble-with-media' : ''} ${message.media?.mediaType === 'audio' ? 'dm-bubble-audio' : ''} ${message.deletedAt ? 'dm-bubble-deleted' : ''}`}>
                          {!message.deletedAt && message.media && (
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
                        {!message.deletedAt && (
                          <div className="dm-message-actions">
                            <button type="button" onClick={() => setReplyTarget(message)}>Reply</button>
                            <button type="button" onClick={() => togglePin(message.id)}>
                              {isPinned ? 'Unpin' : 'Pin'}
                            </button>
                            {isOwn && message.text && (
                              <button type="button" onClick={() => editMessage(message)}>Edit</button>
                            )}
                            {isOwn && (
                              <button type="button" onClick={() => deleteMessage(message.id)}>Delete</button>
                            )}
                          </div>
                        )}
                        <div className="dm-reactions">
                          {!message.deletedAt && Object.entries(message.reactions || {}).map(([emoji, count]) => (
                            count > 0 && (
                              <button
                                type="button"
                                key={emoji}
                                className="dm-reaction-count"
                                onClick={() => addDirectReaction(message.id, emoji)}
                                aria-label={`React with ${emoji}`}
                              >
                                {emoji} {count}
                              </button>
                            )
                          ))}
                          {!message.deletedAt && <div className="dm-reaction-picker-wrap">
                            <button
                              type="button"
                              className="dm-add-reaction"
                              onClick={() => setReactionPickerMessageId(
                                reactionPickerMessageId === message.id ? null : message.id
                              )}
                              aria-label="Add reaction"
                              title="React"
                            >
                              ☺
                            </button>
                            {reactionPickerMessageId === message.id && (
                              <div className="dm-reaction-picker">
                                {['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '❤️'].map(emoji => (
                                  <button
                                    type="button"
                                    key={emoji}
                                    onClick={() => addDirectReaction(message.id, emoji)}
                                    aria-label={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>}
                        </div>
                        <time>
                          {formatTime(message.createdAt)}
                          {message.editedAt && !message.deletedAt && ' · edited'}
                          {isOwn && message.readBy?.includes(activeConversation.otherUser?._id) && ' · seen'}
                        </time>
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
                {replyTarget && (
                  <div className="dm-composer-context">
                    <span><strong>Replying to {replyTarget.username}</strong>{replyTarget.text || replyTarget.media?.fileName || 'Attachment'}</span>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                {selectedFile && (
                  <div className="dm-selected-file">
                    <span aria-hidden="true">📎</span>
                    <span className="dm-selected-file-name">
                      {selectedFile.type === 'audio/webm' ? 'Voice note ready to send' : selectedFile.name}
                    </span>
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
                      accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,audio/webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
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
                    <button
                      className={`dm-voice-button ${isRecording ? 'is-recording' : ''}`}
                      type="button"
                      onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                      disabled={sending}
                      aria-label={isRecording ? 'Stop voice note recording' : 'Record a voice note'}
                    >
                      {isRecording ? '■ Stop recording' : '● Voice note'}
                    </button>
                    <span>Enter to send · Shift + Enter for a new line</span>
                  </div>
                  <button type="submit" disabled={(!draft.trim() && !selectedFile) || sending}>
                    {sending
                      ? (selectedFile ? `Uploading ${uploadProgress}%…` : 'Sending…')
                      : selectedFile?.type === 'audio/webm' ? 'Send voice note' : 'Send'}
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
