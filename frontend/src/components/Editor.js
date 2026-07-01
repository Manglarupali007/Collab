import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000', {
  autoConnect: false,
});

function Editor() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const username = location.state?.username || localStorage.getItem('username') || 'Anonymous';
  const password = location.state?.password || '';
  
  // ===== STATES =====
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [rightTab, setRightSidebarTab] = useState('info');
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUser, setTypingUser] = useState(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState([]);
  const [pollForm, setPollForm] = useState({ question: '', options: ['', ''] });
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [avatar, setAvatar] = useState('');
  const [bio, setBio] = useState('');
  const [toast, setToast] = useState(null);
  
  // ===== MOBILE STATES =====
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  
  const chatEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const receivedMessageIds = useRef(new Set());
  const notificationSoundRef = useRef(null);

  // ===== TOAST =====
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ===== PLAY NOTIFICATION SOUND =====
  const playNotificationSound = () => {
    try {
      // Create simple notification sound using Web Audio API
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
      }, 150);
    } catch (err) {
      // Fallback: just console log
      console.log('🔔 Notification sound');
    }
  };

  // ===== HANDLE RESIZE =====
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ===== REQUEST NOTIFICATION PERMISSION =====
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ===== SCROLL TO BOTTOM =====
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // ===== SOCKET CONNECTION =====
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      showToast('Please login first', 'error');
      navigate('/');
      return;
    }

    if (!password) {
      showToast('Room session expired. Please rejoin.', 'error');
      navigate('/');
      return;
    }

    socket.auth = { token };
    if (socket.io.opts) {
      socket.io.opts.auth = { token };
    }

    const onConnect = () => {
      console.log("✅ Connected to server");
      socket.emit('join-room', { roomId, password });
    };

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    socket.on('connect', onConnect);
    
    // ===== RECONNECT =====
    socket.on('reconnect', () => {
      console.log("🔄 Reconnected, rejoining room...");
      socket.emit('join-room', { roomId, password });
    });
    
    socket.on('message-history', (history) => {
      setChat(history);
    });

    socket.on('user-joined', ({ users: userList, userId: joiningUserId }) => {
      setUsers(userList);
      const joinedUser = userList.find(u => u.id === joiningUserId);
      if (joinedUser && joiningUserId !== socket.id) {
        setChat(prev => [...prev, { id: `sys-${Date.now()}`, system: true, text: `${joinedUser.username} joined the chat` }]);
        showToast(`👋 ${joinedUser.username} joined the chat`, 'info');
      }
    });
    
    socket.on('user-left', ({ userId, username: leaverName }) => {
      setUsers(prev => prev.filter(u => u.id !== userId));
      if (leaverName || userId) {
        const displayName = leaverName || "A user";
        setChat(prev => [...prev, { id: `sys-${Date.now()}`, system: true, text: `${displayName} left the chat` }]);
      }
    });

    socket.on('user-typing', ({ username }) => {
      setTypingUser(username);
    });

    socket.on('user-stop-typing', () => {
      setTypingUser(null);
    });

    // ===== RECEIVE MESSAGE WITH NOTIFICATIONS =====
    socket.on('receive-message', (data) => {
      if (receivedMessageIds.current.has(data.id)) {
        return;
      }
      receivedMessageIds.current.add(data.id);
      
      setChat((prev) => [...prev, data]);
      generateSmartReplies(data.text);
      
      // 🔔 Notification for other users
      if (data.username !== username) {
        // Play sound
        playNotificationSound();
        
        // Browser notification
        if (Notification.permission === 'granted') {
          new Notification(`📩 ${data.username}`, {
            body: data.text || 'Sent a message',
            icon: '/favicon.ico'
          });
        }
      }
      
      setTimeout(() => {
        receivedMessageIds.current.delete(data.id);
      }, 5000);
    });

    socket.on('message-edited', ({ messageId, newText, editedAt }) => {
      setChat(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, text: newText, edited: true, editedAt } : msg
      ));
    });

    socket.on('read-receipt', ({ messageId, readBy, readCount }) => {
      setChat(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, readBy, readCount } : msg
      ));
    });

    socket.on('update-reactions', ({ messageId, reactions }) => {
      setChat(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    });

    socket.on('message-deleted', (messageId) => {
      setChat((prev) => prev.filter(msg => msg.id !== messageId));
      showToast('🗑️ Message deleted', 'info');
    });

    socket.on('update-poll', ({ messageId, poll }) => {
      setChat(prev => prev.map(msg => msg.id === messageId ? { ...msg, poll } : msg));
    });

    socket.on('task-updated', (updatedTasks) => {
      setTasks(updatedTasks);
    });

    socket.on('pinned-history', (pinned) => {
      console.log('📌 Pinned messages updated:', pinned);
      setPinnedMessages(pinned);
    });

    socket.on('kicked', () => {
      showToast('You have been kicked from the room by the owner.', 'error');
      setTimeout(() => navigate('/'), 1500);
    });

    socket.on('error', (err) => {
      showToast(err, 'error');
      navigate('/');
    });

    socket.on('notification', (msg) => {
      showToast(msg, 'info');
    });

    socket.on('connect_error', (err) => {
      console.error("Connection Error:", err.message);
      if (err.message === "Authentication error" || err.message === "jwt expired") {
        showToast('Session expired. Please login again.', 'error');
        localStorage.clear();
        navigate('/');
      } else {
        showToast('Connection lost. Reconnecting...', 'info');
      }
    });

    const messageIds = receivedMessageIds.current;

    return () => {
      socket.removeAllListeners();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      socket.disconnect();
      messageIds.clear();
    };
  }, [roomId, username, password, navigate]);

  // ===== CLICK OUTSIDE EMOJI PICKER =====
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [emojiPickerRef]);

  // ===== READ RECEIPTS OBSERVER =====
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const messageId = entry.target.dataset.messageId;
          if (messageId) {
            socket.emit('message-read', { roomId, messageId });
          }
        }
      });
    }, { threshold: 0.5 });
    
    setTimeout(() => {
      document.querySelectorAll('.message-item').forEach(el => observer.observe(el));
    }, 500);
    
    return () => observer.disconnect();
  }, [chat, roomId]);

  // ===== HANDLE TYPING =====
  const handleTyping = (e) => {
    setMessage(e.target.value);
    socket.emit('typing', { roomId, username });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop-typing', { roomId });
    }, 2000);
  };

  // ===== EMOJI SELECT =====
  const handleEmojiSelect = (emoji) => {
    setMessage(prevMessage => prevMessage + emoji);
    setShowEmojiPicker(false);
  };

  // ===== GENERATE SMART REPLIES =====
  const generateSmartReplies = (text) => {
    if (!text) return;
    const t = text.toLowerCase();
    if (t.includes('meeting') || t.includes('call')) {
      setSuggestedReplies(['👍 I will join', 'Sorry, I am busy', 'What time?']);
    } else if (t.includes('hello') || t.includes('hey') || t.includes('hi')) {
      setSuggestedReplies(['Hey there!', 'Hello!', 'How is it going?']);
    } else if (t.includes('thanks') || t.includes('thank you')) {
      setSuggestedReplies(['👍 You\'re welcome!', '😊 Anytime!', '🙏 Glad to help!']);
    } else {
      setSuggestedReplies(['Okay', 'Thanks!', 'Got it']);
    }
  };

  // ===== SEND MESSAGE =====
  const sendMessage = (e, imageBase64 = null, pollData = null) => {
    if (e) e.preventDefault();
    
    if (editingMessage && message.trim()) {
      socket.emit('edit-message', { 
        roomId, 
        messageId: editingMessage.id, 
        newText: message 
      });
      setMessage('');
      setEditingMessage(null);
      showToast('✏️ Message edited!', 'success');
      return;
    }
    
    if (replyTo && message.trim()) {
      socket.emit('reply-to-message', { 
        roomId, 
        messageId: replyTo.id, 
        replyText: message,
        username,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      setMessage('');
      setReplyTo(null);
      return;
    }
    
    if (!message.trim() && !imageBase64 && !pollData) {
      showToast('Please type a message', 'error');
      return;
    }

    const msgId = Date.now() + Math.random().toString(36).substr(2, 9);
    const msgData = { 
      id: msgId,
      username, 
      text: message, 
      image: imageBase64,
      poll: pollData,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    socket.emit('send-message', { roomId, ...msgData });
    
    setMessage('');
    socket.emit('stop-typing', { roomId });
    setSuggestedReplies([]);
  };

  // ===== ADD REACTION =====
  const addReaction = (messageId, emoji) => {
    socket.emit('add-reaction', { roomId, messageId, emoji });
  };

  // ===== IMAGE UPLOAD =====
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image too large! Max 5MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        sendMessage(e, reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // ===== FILE UPLOAD =====
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        showToast('File too large! Max 20MB', 'error');
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        socket.emit('share-file', {
          roomId,
          username,
          fileName: file.name,
          fileData: reader.result,
          fileType: file.type,
          fileSize: file.size,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        showToast(`📎 ${file.name} uploaded!`, 'success');
      };
      reader.readAsDataURL(file);
    }
  };

  // ===== AVATAR UPLOAD =====
  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('Image too large! Max 2MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // ===== UPDATE PROFILE =====
  const updateProfile = () => {
    socket.emit('update-profile', { roomId, avatar, bio });
    setShowProfileModal(false);
    showToast('✅ Profile updated!', 'success');
  };

  // ===== REPLY =====
  const handleReply = (message) => {
    setReplyTo(message);
    document.getElementById('message-input')?.focus();
  };

  // ===== EDIT MESSAGE =====
  const handleEditMessage = (msg) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    document.getElementById('message-input')?.focus();
  };

  // ===== CREATE POLL =====
  const createPoll = () => {
    if (!pollForm.question.trim() || pollForm.options.filter(o => o.trim()).length < 2) {
      showToast('Please enter a question and at least 2 options', 'error');
      return;
    }
    const pollData = {
      question: pollForm.question,
      options: pollForm.options.filter(opt => opt.trim() !== '').map(opt => ({ text: opt, votes: 0 }))
    };
    sendMessage(null, null, pollData);
    setShowPollModal(false);
    setPollForm({ question: '', options: ['', ''] });
    showToast('📊 Poll created!', 'success');
  };

  // ===== UPDATE TASK STATUS =====
  const updateTaskStatus = (taskId, newStatus) => {
    socket.emit('update-task-status', { roomId, taskId, newStatus });
    showToast(`✅ Task moved to ${newStatus}`, 'success');
  };

  // ===== VOTE =====
  const handleVote = (messageId, optionIndex) => {
    socket.emit('vote', { roomId, messageId, optionIndex });
    showToast('🗳️ Vote cast!', 'success');
  };

  // ===== PIN MESSAGE =====
  const pinMessage = (messageId) => {
    console.log(`📌 Attempting to pin message: ${messageId}`);
    console.log(`📌 Current user role: ${currentUser?.role}`);
    console.log(`📌 Is staff: ${isStaff}`);
    
    if (!isStaff) {
      showToast('❌ Only ADMIN or MANAGER can pin messages!', 'error');
      return;
    }
    
    const isAlreadyPinned = pinnedMessages.some(m => m.id === messageId);
    if (isAlreadyPinned) {
      showToast('ℹ️ Message already pinned!', 'info');
      return;
    }
    
    socket.emit('pin-message', { roomId, messageId });
    showToast('📌 Pinning message...', 'info');
  };

  // ===== UNPIN MESSAGE =====
  const unpinMessage = (messageId) => {
    if (!isStaff) {
      showToast('❌ Only ADMIN or MANAGER can unpin!', 'error');
      return;
    }
    socket.emit('unpin-message', { roomId, messageId });
    showToast('📌 Unpinned!', 'success');
  };

  // ===== DELETE MESSAGE =====
  const deleteMessage = (messageId) => {
    if (window.confirm('Delete this message?')) {
      socket.emit('delete-message', { roomId, messageId });
    }
  };

  // ===== KICK USER =====
  const kickUser = (userIdToKick) => {
    if (window.confirm('Kick this user?')) {
      socket.emit('kick-user', { roomId, userIdToKick });
    }
  };

  // ===== COPY ROOM ID =====
  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    showToast('📋 Room ID copied!', 'success');
  };

  // ===== LEAVE ROOM =====
  const leaveRoom = () => {
    if (window.confirm('Are you sure you want to leave?')) {
      navigate('/');
    }
  };

  // ===== RENDER MESSAGE TEXT =====
  const renderMessageText = (text) => {
    if (!text) return "";
    const parts = text.split(/(@\w+|https?:\/\/[^\s]+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('http')) {
        return <a key={index} href={part} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>{part}</a>;
      }
      if (part.startsWith('@')) {
        return (
          <span key={index} style={{ color: '#fbbf24', fontWeight: 'bold', background: 'rgba(251,191,36,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
            {part}
          </span>
        );
      }
      return part;
    });
  };
  
  // ===== GET STATUS COLOR =====
  const getStatusColor = (status) => {
    switch(status) {
      case 'away': return '#fbbf24';
      case 'busy': return '#f43f5e';
      default: return '#34d399';
    }
  };

  // ===== GET FILE ICON =====
  const getFileIcon = (fileType) => {
    if (!fileType) return '📎';
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('word') || fileType.includes('doc')) return '📝';
    if (fileType.includes('excel') || fileType.includes('sheet')) return '📊';
    if (fileType.includes('zip') || fileType.includes('rar')) return '📦';
    if (fileType.includes('ppt') || fileType.includes('presentation')) return '📑';
    return '📎';
  };

  // ===== EMOJIS =====
  const emojis = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '🚀', '💡', '💻', '✅', '❌', '❤️', '💔', '🤔', '🥳', '🤩', '😎', '💯', '✨'];

  // ===== CURRENT USER =====
  const currentUser = users.find(u => u.id === socket.id);
  const isStaff = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  // ===== FILTERED CHAT =====
  const filteredChat = chat.filter(msg => 
    msg.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ===== STYLES =====
  const isMobileDevice = isMobile;

  // ===== RENDER =====
  return (
    <div style={{
      height: '100vh',
      background: '#0a0f1e',
      display: 'flex',
      flexDirection: 'column',
      color: '#f1f5f9',
      fontFamily: 'Inter, sans-serif',
      overflow: 'hidden',
      paddingBottom: isMobileDevice ? '60px' : '0'
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
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
          animation: 'slideIn 0.4s ease-out',
          borderLeft: `4px solid ${toast.type === 'success' ? '#34d399' : toast.type === 'error' ? '#f43f5e' : '#3b82f6'}`
        }}>
          <span style={{ color: 'white' }}>{toast.message}</span>
        </div>
      )}

      {/* Navbar */}
      <div style={{
        background: 'rgba(10,15,30,0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: isMobileDevice ? '10px 12px' : '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 20,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobileDevice ? '10px' : '16px', minWidth: 0 }}>
          <div style={{
            width: isMobileDevice ? '32px' : '40px',
            height: isMobileDevice ? '32px' : '40px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: isMobileDevice ? '14px' : '18px',
            boxShadow: '0 4px 20px rgba(59,130,246,0.2)',
            flexShrink: 0
          }}>#</div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 700,
              fontSize: isMobileDevice ? '12px' : '14px',
              letterSpacing: '-0.025em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap'
            }}>
              {isMobileDevice ? 'Room' : `Private Room: ${roomId}`}
              <span style={{
                fontSize: isMobileDevice ? '8px' : '10px',
                background: 'rgba(52,211,153,0.2)',
                color: '#34d399',
                padding: '2px 8px',
                borderRadius: '20px',
                fontWeight: 'normal',
                whiteSpace: 'nowrap'
              }}>{users.length} online</span>
            </div>
            <div style={{ fontSize: isMobileDevice ? '9px' : '11px', color: '#6b7280' }}>
              {users.length} members • {chat.length} messages
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobileDevice ? '6px' : '12px', flexShrink: 0 }}>
          {!isMobileDevice && (
            <input
              type="text"
              placeholder="🔍 Search messages..."
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '8px 16px',
                fontSize: '12px',
                color: 'white',
                outline: 'none',
                width: '180px',
                transition: 'all 0.3s ease'
              }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
          )}
          
          {/* Mobile Menu Toggle */}
          {isMobileDevice && (
            <button
              onClick={() => setShowMobileSidebar(!showMobileSidebar)}
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              👥
            </button>
          )}

          <button
            onClick={() => setShowProfileModal(true)}
            style={{
              width: isMobileDevice ? '28px' : '36px',
              height: isMobileDevice ? '28px' : '36px',
              borderRadius: '50%',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: isMobileDevice ? '10px' : '14px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              overflow: 'hidden',
              flexShrink: 0
            }}
            onMouseEnter={(e) => e.target.style.background = '#334155'}
            onMouseLeave={(e) => e.target.style.background = '#1e293b'}
          >
            {currentUser?.avatar ? (
              <img src={currentUser.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              username.charAt(0).toUpperCase()
            )}
          </button>
          <button
            onClick={copyRoomId}
            style={{
              background: '#3b82f6',
              border: 'none',
              borderRadius: isMobileDevice ? '8px' : '12px',
              padding: isMobileDevice ? '4px 10px' : '8px 16px',
              color: 'white',
              fontSize: isMobileDevice ? '10px' : '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 20px rgba(59,130,246,0.2)',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => e.target.style.background = '#2563eb'}
            onMouseLeave={(e) => e.target.style.background = '#3b82f6'}
          >
            {isMobileDevice ? '🔗' : '🔗 Invite'}
          </button>
          <button
            onClick={leaveRoom}
            style={{
              background: 'rgba(244,63,94,0.1)',
              border: '1px solid rgba(244,63,94,0.2)',
              borderRadius: isMobileDevice ? '8px' : '12px',
              padding: isMobileDevice ? '4px 10px' : '8px 16px',
              color: '#f43f5e',
              fontSize: isMobileDevice ? '10px' : '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => { e.target.style.background = 'rgba(244,63,94,0.2)'; }}
            onMouseLeave={(e) => { e.target.style.background = 'rgba(244,63,94,0.1)'; }}
          >
            {isMobileDevice ? '✕' : '⚡ Exit'}
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: isMobileDevice ? 'column' : 'row' }}>
        {/* Left Sidebar */}
        <div style={{
          display: isMobileDevice ? (showMobileSidebar ? 'flex' : 'none') : 'flex',
          width: isMobileDevice ? '100%' : '200px',
          maxHeight: isMobileDevice ? '50%' : '100%',
          background: '#0a0f1e',
          borderRight: isMobileDevice ? 'none' : '1px solid rgba(255,255,255,0.05)',
          borderBottom: isMobileDevice ? '1px solid rgba(255,255,255,0.05)' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          position: isMobileDevice ? 'absolute' : 'relative',
          top: isMobileDevice ? 0 : 'auto',
          left: 0,
          right: 0,
          zIndex: 50,
          background: isMobileDevice ? 'rgba(10,15,30,0.98)' : '#0a0f1e',
          backdropFilter: isMobileDevice ? 'blur(20px)' : 'none'
        }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <select
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                padding: '8px',
                fontSize: '12px',
                color: 'white',
                outline: 'none'
              }}
              onChange={(e) => socket.emit('update-status', { roomId, status: e.target.value })}
            >
              <option value="online">🟢 Online</option>
              <option value="away">🟡 Away</option>
              <option value="busy">🔴 Busy</option>
            </select>
            {isMobileDevice && (
              <button
                onClick={() => setShowMobileSidebar(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  marginLeft: '8px'
                }}
              >
                ✕
              </button>
            )}
          </div>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#6b7280', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Participants</span>
            <span style={{ color: '#60a5fa', fontSize: '10px' }}>{users.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {users.map((user) => (
              <div
                key={user.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: isMobileDevice ? '10px 12px' : '12px 16px',
                  borderRadius: '12px',
                  transition: 'all 0.3s ease',
                  cursor: 'default'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ position: 'relative', width: isMobileDevice ? '36px' : '40px', height: isMobileDevice ? '36px' : '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #1e293b, #0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobileDevice ? '11px' : '12px', fontWeight: 700, overflow: 'hidden' }}>
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                  <div style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    width: isMobileDevice ? '12px' : '14px',
                    height: isMobileDevice ? '12px' : '14px',
                    borderRadius: '50%',
                    border: '2px solid #0a0f1e',
                    background: getStatusColor(user.status)
                  }}></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: isMobileDevice ? '12px' : '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {user.username} {user.username === username && <span style={{ fontSize: isMobileDevice ? '7px' : '8px', color: '#60a5fa' }}>(You)</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{
                      fontSize: isMobileDevice ? '7px' : '8px',
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: user.role === 'ADMIN' ? '#f43f5e' : user.role === 'MANAGER' ? '#818cf8' : '#4b5563'
                    }}>
                      {user.role}
                    </span>
                    {user.bio && <span style={{ fontSize: isMobileDevice ? '7px' : '8px', color: '#4b5563' }}>· {user.bio}</span>}
                  </div>
                </div>
                {isStaff && user.username !== username && (
                  <button
                    onClick={() => kickUser(user.id)}
                    style={{
                      fontSize: isMobileDevice ? '8px' : '9px',
                      background: 'rgba(244,63,94,0.1)',
                      border: 'none',
                      borderRadius: '6px',
                      padding: isMobileDevice ? '2px 6px' : '4px 8px',
                      color: '#f43f5e',
                      cursor: 'pointer',
                      opacity: 0,
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = 0}
                  >
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0f1e' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobileDevice ? '10px' : '16px' }}>
            <div style={{ maxWidth: '1024px', margin: '0 auto', paddingTop: isMobileDevice ? '8px' : '16px' }}>
              {filteredChat.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: isMobileDevice ? '200px' : '256px', textAlign: 'center' }}>
                  <div style={{ fontSize: isMobileDevice ? '40px' : '48px', marginBottom: '12px' }}>💬</div>
                  <div style={{ fontSize: isMobileDevice ? '16px' : '20px', fontWeight: 700, color: '#e2e8f0' }}>No messages yet</div>
                  <div style={{ fontSize: isMobileDevice ? '12px' : '14px', color: '#6b7280', marginTop: '8px' }}>Start the conversation by sending a message!</div>
                </div>
              ) : (
                filteredChat.map((msg, i) => (
                  msg.system ? (
                    <div key={msg.id || i} style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280', fontSize: isMobileDevice ? '9px' : '10px', padding: isMobileDevice ? '4px 12px' : '6px 16px', borderRadius: '20px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.1em', border: '1px solid rgba(255,255,255,0.05)' }}>{msg.text}</span>
                    </div>
                  ) : (
                    <div
                      key={msg.id || i}
                      data-message-id={msg.id}
                      className="message-item"
                      style={{
                        display: 'flex',
                        marginBottom: isMobileDevice ? '6px' : '8px',
                        animation: 'fadeIn 0.3s ease-out',
                        justifyContent: msg.username === username ? 'flex-end' : 'flex-start'
                      }}
                      onMouseEnter={(e) => {
                        const menu = e.currentTarget.querySelector('.action-menu');
                        if (menu) menu.style.display = 'flex';
                      }}
                      onMouseLeave={(e) => {
                        const menu = e.currentTarget.querySelector('.action-menu');
                        if (menu) menu.style.display = 'none';
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: isMobileDevice ? '6px' : '8px',
                        maxWidth: isMobileDevice ? '90%' : '85%',
                        flexDirection: msg.username === username ? 'row-reverse' : 'row'
                      }}>
                        <div style={{ width: isMobileDevice ? '28px' : '32px', height: isMobileDevice ? '28px' : '32px', borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobileDevice ? '9px' : '10px', fontWeight: 700, border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                          {msg.username.charAt(0).toUpperCase()}
                        </div>
                        <div style={{
                          padding: isMobileDevice ? '10px 14px' : '12px 16px',
                          borderRadius: '16px',
                          position: 'relative',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                          minWidth: isMobileDevice ? '50px' : '60px',
                          maxWidth: isMobileDevice ? '90%' : '75%',
                          ...(msg.username === username 
                            ? { background: 'linear-gradient(135deg, #3b82f6, #6366f1)', borderBottomRightRadius: '4px' }
                            : { background: 'rgba(255,255,255,0.07)', borderBottomLeftRadius: '4px' }
                          )
                        }}>
                          {/* Reply Indicator */}
                          {msg.replyTo && (
                            <div style={{ background: 'rgba(255,255,255,0.08)', padding: isMobileDevice ? '4px 10px' : '6px 12px', borderRadius: '6px', marginBottom: '6px', borderLeft: '2px solid #60a5fa', fontSize: isMobileDevice ? '10px' : '11px' }}>
                              <span style={{ color: '#60a5fa', fontWeight: 700 }}>@{msg.replyTo.username}</span>
                              <span style={{ color: '#94a3b8', marginLeft: '6px' }}>{msg.replyTo.text}</span>
                            </div>
                          )}
                          
                          {msg.username !== username && (
                            <div style={{ fontSize: isMobileDevice ? '9px' : '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#60a5fa', marginBottom: isMobileDevice ? '2px' : '4px' }}>{msg.username}</div>
                          )}
                          
                          {/* File */}
                          {msg.file && (
                            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: isMobileDevice ? '10px' : '12px', padding: isMobileDevice ? '10px' : '12px', marginBottom: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: isMobileDevice ? '10px' : '12px' }}>
                                <div style={{ width: isMobileDevice ? '40px' : '48px', height: isMobileDevice ? '40px' : '48px', background: 'rgba(59,130,246,0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobileDevice ? '20px' : '24px' }}>
                                  {getFileIcon(msg.file.type)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: isMobileDevice ? '12px' : '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.file.name}</div>
                                  <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280' }}>{(msg.file.size / 1024).toFixed(1)} KB</div>
                                </div>
                                <a href={msg.file.data} download={msg.file.name} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: isMobileDevice ? '6px' : '8px', padding: isMobileDevice ? '4px 10px' : '6px 12px', fontSize: isMobileDevice ? '11px' : '12px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>⬇️</a>
                              </div>
                            </div>
                          )}
                          
                          {/* Image */}
                          {msg.image && (
                            <img src={msg.image} alt="shared" style={{ borderRadius: isMobileDevice ? '10px' : '12px', marginBottom: '6px', maxWidth: '100%', maxHeight: isMobileDevice ? '200px' : '320px', objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', cursor: 'pointer' }} onClick={() => window.open(msg.image, '_blank')} />
                          )}
                          
                          {/* Poll */}
                          {msg.poll && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: isMobileDevice ? '12px' : '16px', borderRadius: isMobileDevice ? '10px' : '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '6px', minWidth: isMobileDevice ? '180px' : '240px' }}>
                              <div style={{ fontWeight: 700, fontSize: isMobileDevice ? '13px' : '14px', marginBottom: isMobileDevice ? '8px' : '12px', color: '#60a5fa' }}>📊 {msg.poll.question}</div>
                              {msg.poll.options.map((opt, idx) => (
                                <button key={idx} onClick={() => handleVote(msg.id, idx)} style={{ width: '100%', textAlign: 'left', marginBottom: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                  <div style={{ position: 'relative', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: isMobileDevice ? '6px' : '8px', overflow: 'hidden' }}>
                                    <div style={{
                                      position: 'absolute',
                                      top: 0,
                                      left: 0,
                                      height: '100%',
                                      background: 'linear-gradient(90deg, rgba(59,130,246,0.2), rgba(139,92,246,0.2))',
                                      borderRadius: '6px',
                                      transition: 'width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                      width: `${msg.poll.options.reduce((a, b) => a + b.votes, 0) > 0 ? (opt.votes / msg.poll.options.reduce((a, b) => a + b.votes, 0)) * 100 : 0}%`
                                    }}></div>
                                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', fontSize: isMobileDevice ? '10px' : '11px' }}>
                                      <span style={{ color: '#e2e8f0' }}>{opt.text}</span>
                                      <span style={{ fontWeight: 700, color: '#94a3b8' }}>{opt.votes}</span>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          
                          <div style={{ fontSize: isMobileDevice ? '13px' : '14px', lineHeight: 1.6, paddingRight: isMobileDevice ? '20px' : '32px' }}>
                            {renderMessageText(msg.text)}
                            {msg.edited && <span style={{ fontSize: isMobileDevice ? '7px' : '8px', color: '#6b7280', marginLeft: '4px' }}>(edited)</span>}
                          </div>
                          
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '6px' }}>
                              {Object.entries(msg.reactions).map(([e, c]) => (
                                <span key={e} style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 6px', borderRadius: '4px', fontSize: isMobileDevice ? '9px' : '10px' }}>{e} {c}</span>
                              ))}
                            </div>
                          )}
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'absolute', bottom: isMobileDevice ? '3px' : '4px', right: isMobileDevice ? '6px' : '8px', opacity: 0.6, fontSize: isMobileDevice ? '7px' : '8px' }}>
                            <span>{msg.time}</span>
                            {msg.username === username && (
                              <span style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '2px' }}>
                                {msg.readBy && msg.readBy.length > 0 ? (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    ✓✓ <span style={{ fontSize: isMobileDevice ? '7px' : '8px', color: '#6b7280' }}>{msg.readBy.length}</span>
                                  </span>
                                ) : '✓'}
                              </span>
                            )}
                          </div>
                          
                          {/* Action Menu */}
                          <div className="action-menu" style={{
                            position: 'absolute',
                            top: isMobileDevice ? '-20px' : '-24px',
                            right: 0,
                            display: 'none',
                            gap: '3px',
                            background: '#0f172a',
                            padding: '3px',
                            borderRadius: isMobileDevice ? '6px' : '8px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                          }}>
                            <button onClick={() => handleReply(msg)} style={{ fontSize: isMobileDevice ? '9px' : '10px', padding: '3px 5px', background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s ease' }} title="Reply">↩️</button>
                            {msg.username === username && (
                              <button onClick={() => handleEditMessage(msg)} style={{ fontSize: isMobileDevice ? '9px' : '10px', padding: '3px 5px', background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s ease' }} title="Edit">✏️</button>
                            )}
                            {['👍','❤️','😂','😮'].map(e => (
                              <button key={e} onClick={() => addReaction(msg.id, e)} style={{ fontSize: isMobileDevice ? '12px' : '14px', padding: '3px 5px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s ease' }}>{e}</button>
                            ))}
                            {(isStaff || msg.username === username) && (
                              <button onClick={() => deleteMessage(msg.id)} style={{ fontSize: isMobileDevice ? '9px' : '10px', padding: '3px 5px', background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', borderRadius: '4px', transition: 'all 0.2s ease' }} title="Delete">🗑️</button>
                            )}
                            {isStaff && (
                              <button 
                                onClick={() => {
                                  console.log('📌 Pin button clicked for:', msg.id);
                                  pinMessage(msg.id);
                                }} 
                                style={{ 
                                  fontSize: isMobileDevice ? '9px' : '10px', 
                                  padding: '3px 5px', 
                                  background: 'none', 
                                  border: 'none', 
                                  color: pinnedMessages.some(m => m.id === msg.id) ? '#34d399' : '#fbbf24', 
                                  cursor: 'pointer', 
                                  borderRadius: '4px', 
                                  transition: 'all 0.2s ease' 
                                }} 
                                title={pinnedMessages.some(m => m.id === msg.id) ? "Unpin" : "Pin"}
                              >
                                {pinnedMessages.some(m => m.id === msg.id) ? '📌✅' : '📌'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                ))
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{
          width: isMobileDevice ? '100%' : '280px',
          maxHeight: isMobileDevice ? '200px' : '100%',
          background: '#0a0f1e',
          borderLeft: isMobileDevice ? 'none' : '1px solid rgba(255,255,255,0.05)',
          borderTop: isMobileDevice ? '1px solid rgba(255,255,255,0.05)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
          position: isMobileDevice ? 'relative' : 'static'
        }}>
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {['info', 'tasks', 'stats'].map(tab => (
              <button
                key={tab}
                onClick={() => setRightSidebarTab(tab)}
                style={{
                  flex: 1,
                  padding: isMobileDevice ? '8px' : '12px',
                  fontSize: isMobileDevice ? '8px' : '10px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  background: 'none',
                  border: 'none',
                  color: rightTab === tab ? '#60a5fa' : '#4b5563',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  position: 'relative'
                }}
              >
                {tab}
                {rightTab === tab && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                    borderRadius: '2px'
                  }}></div>
                )}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobileDevice ? '10px' : '16px' }}>
            {rightTab === 'info' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📌 Pinned</span>
                  <span style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#60a5fa' }}>{pinnedMessages.length}</span>
                </div>
                {pinnedMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#4b5563', fontSize: isMobileDevice ? '10px' : '12px', padding: isMobileDevice ? '16px 0' : '32px 0' }}>
                    No pinned messages
                    <div style={{ fontSize: isMobileDevice ? '8px' : '10px', color: '#6b7280', marginTop: '4px' }}>
                      {isStaff ? 'ADMIN can pin 📌' : 'Only ADMIN can pin'}
                    </div>
                  </div>
                ) : (
                  pinnedMessages.map(pm => (
                    <div key={pm.id} style={{ 
                      background: 'rgba(255,255,255,0.03)', 
                      padding: isMobileDevice ? '10px' : '12px', 
                      borderRadius: isMobileDevice ? '10px' : '12px', 
                      border: '1px solid rgba(255,255,255,0.05)',
                      marginBottom: '6px',
                      position: 'relative'
                    }}>
                      <div style={{ fontSize: isMobileDevice ? '10px' : '11px', color: '#60a5fa', fontWeight: 700, marginBottom: '2px' }}>
                        {pm.username} 
                        {pm.pinnedBy && <span style={{ fontSize: isMobileDevice ? '7px' : '8px', color: '#6b7280', marginLeft: '6px' }}>by {pm.pinnedBy}</span>}
                      </div>
                      <div style={{ fontSize: isMobileDevice ? '10px' : '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{pm.text}</div>
                      {isStaff && (
                        <button 
                          onClick={() => unpinMessage(pm.id)}
                          style={{
                            position: 'absolute',
                            top: '6px',
                            right: '6px',
                            background: 'none',
                            border: 'none',
                            color: '#6b7280',
                            cursor: 'pointer',
                            fontSize: isMobileDevice ? '9px' : '10px',
                            padding: '2px'
                          }}
                          title="Unpin"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
            {rightTab === 'tasks' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>✅ Tasks</span>
                  <span style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#60a5fa' }}>{tasks.length}</span>
                </div>
                {['todo', 'doing', 'done'].map(status => {
                  const statusTasks = tasks.filter(t => t.status === status);
                  return (
                    <div key={status} style={{ marginBottom: isMobileDevice ? '8px' : '12px' }}>
                      <div style={{ fontSize: isMobileDevice ? '8px' : '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: status === 'todo' ? '#fbbf24' : status === 'doing' ? '#60a5fa' : '#34d399', marginBottom: '4px' }}>
                        {status} ({statusTasks.length})
                      </div>
                      {statusTasks.map(task => (
                        <div key={task.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: isMobileDevice ? '10px' : '12px', padding: isMobileDevice ? '10px' : '12px', marginBottom: '6px', transition: 'all 0.3s ease' }}>
                          <div style={{ fontSize: isMobileDevice ? '11px' : '12px', fontWeight: 600, marginBottom: '6px' }}>{task.title}</div>
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            {['todo', 'doing', 'done'].filter(s => s !== status).map(s => (
                              <button key={s} onClick={() => updateTaskStatus(task.id, s)} style={{ fontSize: isMobileDevice ? '8px' : '9px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '2px 6px', color: '#94a3b8', cursor: 'pointer', textTransform: 'uppercase', transition: 'all 0.3s ease' }} onMouseEnter={(e) => { e.target.style.background = '#3b82f6'; e.target.style.color = 'white'; }} onMouseLeave={(e) => { e.target.style.background = 'rgba(255,255,255,0.05)'; e.target.style.color = '#94a3b8'; }}>{s}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <button onClick={() => { const title = prompt('📝 Enter task title:'); if (title && title.trim()) { socket.emit('create-task', { roomId, task: { title: title.trim(), assignee: username, createdBy: username, createdAt: new Date().toISOString() } }); showToast('✅ Task created!', 'success'); } }} style={{ width: '100%', padding: isMobileDevice ? '8px' : '10px', background: '#3b82f6', border: 'none', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 20px rgba(59,130,246,0.2)' }} onMouseEnter={(e) => e.target.style.background = '#2563eb'} onMouseLeave={(e) => e.target.style.background = '#3b82f6'}>+ New Task</button>
              </div>
            )}
            {rightTab === 'stats' && (
              <div>
                <div style={{ fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>📊 Stats</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: isMobileDevice ? '10px' : '12px', borderRadius: isMobileDevice ? '10px' : '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280' }}>Messages</div>
                    <div style={{ fontSize: isMobileDevice ? '18px' : '24px', fontWeight: 700 }}>{chat.filter(m => !m.system).length}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: isMobileDevice ? '10px' : '12px', borderRadius: isMobileDevice ? '10px' : '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280' }}>Users</div>
                    <div style={{ fontSize: isMobileDevice ? '18px' : '24px', fontWeight: 700 }}>{users.length}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: isMobileDevice ? '10px' : '12px', borderRadius: isMobileDevice ? '10px' : '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280' }}>Pinned</div>
                    <div style={{ fontSize: isMobileDevice ? '18px' : '24px', fontWeight: 700 }}>{pinnedMessages.length}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: isMobileDevice ? '10px' : '12px', borderRadius: isMobileDevice ? '10px' : '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280' }}>Tasks</div>
                    <div style={{ fontSize: isMobileDevice ? '18px' : '24px', fontWeight: 700 }}>{tasks.length}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div style={{
        background: 'rgba(10,15,30,0.85)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: isMobileDevice ? '8px 10px' : '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        flexShrink: 0
      }}>
        {/* Smart Replies */}
        {suggestedReplies.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobileDevice ? '4px' : '8px', marginBottom: '8px', marginLeft: isMobileDevice ? '0' : '48px' }}>
            {suggestedReplies.map((reply, i) => (
              <button key={i} onClick={() => { setMessage(reply); sendMessage(null); }} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '20px', padding: isMobileDevice ? '2px 10px' : '4px 14px', fontSize: isMobileDevice ? '9px' : '10px', color: '#60a5fa', cursor: 'pointer', transition: 'all 0.3s ease', fontWeight: 700 }} onMouseEnter={(e) => { e.target.style.background = '#3b82f6'; e.target.style.color = 'white'; }} onMouseLeave={(e) => { e.target.style.background = 'rgba(59,130,246,0.1)'; e.target.style.color = '#60a5fa'; }}>{reply}</button>
            ))}
          </div>
        )}

        {/* Reply Indicator */}
        {replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(59,130,246,0.1)', padding: isMobileDevice ? '6px 12px' : '8px 16px', borderRadius: isMobileDevice ? '10px' : '12px', marginBottom: '6px', marginLeft: isMobileDevice ? '0' : '48px', borderLeft: '4px solid #3b82f6' }}>
            <span style={{ fontSize: isMobileDevice ? '10px' : '11px', color: '#60a5fa' }}>Replying to {replyTo.username}:</span>
            <span style={{ fontSize: isMobileDevice ? '10px' : '11px', color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyTo.text}</span>
            <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: isMobileDevice ? '12px' : '14px' }}>✕</button>
          </div>
        )}

        {/* Edit Indicator */}
        {editingMessage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(251,191,36,0.1)', padding: isMobileDevice ? '6px 12px' : '8px 16px', borderRadius: isMobileDevice ? '10px' : '12px', marginBottom: '6px', marginLeft: isMobileDevice ? '0' : '48px', borderLeft: '4px solid #fbbf24' }}>
            <span style={{ fontSize: isMobileDevice ? '10px' : '11px', color: '#fbbf24' }}>Editing:</span>
            <span style={{ fontSize: isMobileDevice ? '10px' : '11px', color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editingMessage.text}</span>
            <button onClick={() => { setEditingMessage(null); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: isMobileDevice ? '12px' : '14px' }}>✕</button>
          </div>
        )}

        {/* Typing Indicator */}
        {typingUser && (
          <div style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#34d399', fontWeight: 700, marginBottom: '6px', marginLeft: isMobileDevice ? '0' : '48px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#34d399', display: 'inline-block', animation: 'pulse 1.5s infinite' }}></span>
            {typingUser} typing...
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={sendMessage} style={{ display: 'flex', alignItems: 'center', gap: isMobileDevice ? '4px' : '8px', maxWidth: '1024px', margin: '0 auto', width: '100%' }}>
          <label style={{ background: 'none', border: 'none', color: '#6b7280', padding: isMobileDevice ? '4px' : '8px', borderRadius: isMobileDevice ? '8px' : '12px', cursor: 'pointer', transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobileDevice ? '28px' : '40px', height: isMobileDevice ? '28px' : '40px', flexShrink: 0 }} onMouseEnter={(e) => e.currentTarget.style.color = '#60a5fa'} onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}>
            <svg viewBox="0 0 24 24" width={isMobileDevice ? "16" : "22"} height={isMobileDevice ? "16" : "22"} fill="currentColor">
              <path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V4.35c0-2.001-1.53-3.531-3.531-3.531S8.469 2.35 8.469 4.35v7.061c0 2.001 1.53 3.531 3.53 3.531zm6.235-3.531c0 3.531-2.942 6.002-6.235 6.002s-6.235-2.471-6.235-6.002H3.705c0 4.001 3.177 7.296 7.061 7.767V23.5h2.467v-4.324c3.884-.471 7.061-3.766 7.061-7.767h-2.059z"/>
            </svg>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
          </label>

          <label style={{ background: 'none', border: 'none', color: '#6b7280', padding: isMobileDevice ? '4px' : '8px', borderRadius: isMobileDevice ? '8px' : '12px', cursor: 'pointer', transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobileDevice ? '28px' : '40px', height: isMobileDevice ? '28px' : '40px', flexShrink: 0 }} onMouseEnter={(e) => e.currentTarget.style.color = '#34d399'} onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}>
            <svg viewBox="0 0 24 24" width={isMobileDevice ? "16" : "22"} height={isMobileDevice ? "16" : "22"} fill="currentColor">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt,.ppt,.pptx" />
          </label>

          <div style={{ position: 'relative' }} ref={emojiPickerRef}>
            <button type="button" onClick={() => setShowEmojiPicker(prev => !prev)} style={{ background: 'none', border: 'none', color: '#6b7280', padding: isMobileDevice ? '4px' : '8px', borderRadius: isMobileDevice ? '8px' : '12px', cursor: 'pointer', transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', width: isMobileDevice ? '28px' : '40px', height: isMobileDevice ? '28px' : '40px', flexShrink: 0 }} onMouseEnter={(e) => e.currentTarget.style.color = '#fbbf24'} onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}>
              <svg viewBox="0 0 24 24" width={isMobileDevice ? "18" : "24"} height={isMobileDevice ? "18" : "24"} fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.486 22 2 17.514 2 12S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zM8 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-4 8c-2.206 0-4-1.794-4-4h2c0 1.103.897 2 2 2s2-.897 2-2h2c0 2.206-1.794 4-4 4z"/>
              </svg>
            </button>
            {showEmojiPicker && (
              <div style={{ 
                position: 'absolute', 
                bottom: isMobileDevice ? '40px' : '48px', 
                left: isMobileDevice ? '-80px' : 0,
                background: '#1e293b', 
                border: '1px solid rgba(255,255,255,0.08)', 
                borderRadius: isMobileDevice ? '12px' : '16px', 
                padding: isMobileDevice ? '8px' : '12px', 
                display: 'grid', 
                gridTemplateColumns: isMobileDevice ? 'repeat(5, 1fr)' : 'repeat(6, 1fr)',
                gap: '3px', 
                zIndex: 50, 
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                width: isMobileDevice ? '260px' : 'auto'
              }}>
                {emojis.map((emoji, index) => (
                  <button key={index} type="button" onClick={() => handleEmojiSelect(emoji)} style={{ padding: isMobileDevice ? '6px' : '8px', fontSize: isMobileDevice ? '16px' : '20px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '6px', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>{emoji}</button>
                ))}
              </div>
            )}
          </div>

          <input
            id="message-input"
            type="text"
            value={message}
            onChange={handleTyping}
            placeholder={replyTo ? `Reply to ${replyTo.username}...` : editingMessage ? "Edit..." : "Message..."}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: isMobileDevice ? '20px' : '24px',
              padding: isMobileDevice ? '8px 14px' : '12px 20px',
              fontSize: isMobileDevice ? '13px' : '14px',
              color: 'white',
              outline: 'none',
              transition: 'all 0.3s ease',
              minWidth: isMobileDevice ? '60px' : '100px'
            }}
            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
            onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
          />

          <button
            type="submit"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              border: 'none',
              borderRadius: '50%',
              padding: isMobileDevice ? '8px' : '12px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: isMobileDevice ? '36px' : '48px',
              height: isMobileDevice ? '36px' : '48px',
              flexShrink: 0
            }}
            onMouseEnter={(e) => { e.target.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)'; }}
            onMouseLeave={(e) => { e.target.style.background = 'linear-gradient(135deg, #3b82f6, #8b5cf6)'; }}
          >
            <svg viewBox="0 0 24 24" height={isMobileDevice ? "18" : "24"} width={isMobileDevice ? "18" : "24"} preserveAspectRatio="xMidYMid meet" fill="white">
              <path d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845L1.101,21.757z"/>
            </svg>
          </button>
        </form>
      </div>

      {/* Poll Button */}
      <button
        onClick={() => setShowPollModal(true)}
        style={{
          position: 'fixed',
          bottom: isMobileDevice ? '70px' : '96px',
          right: isMobileDevice ? '12px' : '24px',
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          border: 'none',
          borderRadius: '50%',
          padding: isMobileDevice ? '10px' : '14px',
          color: 'white',
          fontSize: isMobileDevice ? '16px' : '20px',
          cursor: 'pointer',
          boxShadow: '0 8px 32px rgba(59,130,246,0.3)',
          transition: 'all 0.3s ease',
          zIndex: 10
        }}
        onMouseEnter={(e) => { e.target.style.transform = 'scale(1.1)'; }}
        onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; }}
      >
        📊
      </button>

      {/* Mobile Bottom Navigation */}
      {isMobileDevice && (
        <div style={{
          display: 'flex',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(10,15,30,0.95)',
          backdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          zIndex: 100,
          padding: '6px 0',
          justifyContent: 'space-around'
        }}>
          <button
            onClick={() => setRightSidebarTab('info')}
            style={{
              background: 'none',
              border: 'none',
              color: rightTab === 'info' ? '#60a5fa' : '#6b7280',
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            <span style={{ fontSize: '18px' }}>📌</span>
            <span>Info</span>
          </button>
          <button
            onClick={() => setRightSidebarTab('tasks')}
            style={{
              background: 'none',
              border: 'none',
              color: rightTab === 'tasks' ? '#60a5fa' : '#6b7280',
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            <span style={{ fontSize: '18px' }}>✅</span>
            <span>Tasks</span>
          </button>
          <button
            onClick={() => setRightSidebarTab('stats')}
            style={{
              background: 'none',
              border: 'none',
              color: rightTab === 'stats' ? '#60a5fa' : '#6b7280',
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            <span style={{ fontSize: '18px' }}>📊</span>
            <span>Stats</span>
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            <span style={{ fontSize: '18px' }}>👤</span>
            <span>Profile</span>
          </button>
        </div>
      )}

      {/* Profile Modal */}
      {showProfileModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '16px'
        }} onClick={() => setShowProfileModal(false)}>
          <div style={{
            background: '#0f172a',
            padding: isMobileDevice ? '20px' : '32px',
            borderRadius: isMobileDevice ? '20px' : '24px',
            maxWidth: '448px',
            width: '100%',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: isMobileDevice ? '20px' : '24px', fontWeight: 700, marginBottom: '20px', background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Edit Profile</div>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ width: isMobileDevice ? '72px' : '96px', height: isMobileDevice ? '72px' : '96px', borderRadius: '50%', background: 'linear-gradient(135deg, #1e293b, #0f172a)', overflow: 'hidden', marginBottom: '10px', position: 'relative', cursor: 'pointer' }} onMouseEnter={(e) => { const label = e.currentTarget.querySelector('.avatar-label'); if (label) label.style.opacity = 1; }} onMouseLeave={(e) => { const label = e.currentTarget.querySelector('.avatar-label'); if (label) label.style.opacity = 0; }}>
                {avatar ? (
                  <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobileDevice ? '28px' : '36px', fontWeight: 700, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
                    {username.charAt(0).toUpperCase()}
                  </div>
                )}
                <label className="avatar-label" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.3s ease', cursor: 'pointer' }}>
                  <span style={{ color: 'white', fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700 }}>Change</span>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />
                </label>
              </div>
              <div style={{ fontSize: isMobileDevice ? '13px' : '14px', fontWeight: 700 }}>{username}</div>
            </div>

            <div>
              <label style={{ fontSize: isMobileDevice ? '9px' : '10px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bio</label>
              <textarea style={{ width: '100%', padding: isMobileDevice ? '10px' : '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontSize: isMobileDevice ? '13px' : '14px', outline: 'none', marginBottom: '10px', resize: 'none', boxSizing: 'border-box' }} rows="3" placeholder="Tell about yourself..." value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={() => setShowProfileModal(false)} style={{ flex: 1, padding: isMobileDevice ? '10px' : '12px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease' }}>Cancel</button>
              <button onClick={updateProfile} style={{ flex: 1, padding: isMobileDevice ? '10px' : '12px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 20px rgba(59,130,246,0.2)' }}>💾 Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Poll Modal */}
      {showPollModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '16px'
        }} onClick={() => setShowPollModal(false)}>
          <div style={{
            background: '#0f172a',
            padding: isMobileDevice ? '20px' : '32px',
            borderRadius: isMobileDevice ? '20px' : '24px',
            maxWidth: '448px',
            width: '100%',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: isMobileDevice ? '20px' : '24px', fontWeight: 700, marginBottom: '20px', background: 'linear-gradient(135deg, #60a5fa, #a78bfa, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>📊 Create Poll</div>
            
            <input placeholder="Question" style={{ width: '100%', padding: isMobileDevice ? '10px' : '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontSize: isMobileDevice ? '13px' : '14px', outline: 'none', marginBottom: '10px', boxSizing: 'border-box' }} value={pollForm.question} onChange={e => setPollForm({ ...pollForm, question: e.target.value })} />
            
            {pollForm.options.map((opt, i) => (
              <input key={i} placeholder={`Option ${i + 1}`} style={{ width: '100%', padding: isMobileDevice ? '10px' : '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontSize: isMobileDevice ? '13px' : '14px', outline: 'none', marginBottom: '10px', boxSizing: 'border-box' }} value={opt} onChange={e => { const newOpts = [...pollForm.options]; newOpts[i] = e.target.value; setPollForm({ ...pollForm, options: newOpts }); }} />
            ))}
            
            <button onClick={() => setPollForm({ ...pollForm, options: [...pollForm.options, ''] })} style={{ color: '#60a5fa', fontSize: isMobileDevice ? '10px' : '12px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', marginBottom: '12px' }}>+ Add Option</button>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={() => setShowPollModal(false)} style={{ flex: 1, padding: isMobileDevice ? '10px' : '12px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease' }}>Cancel</button>
              <button onClick={createPoll} style={{ flex: 1, padding: isMobileDevice ? '10px' : '12px', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none', borderRadius: isMobileDevice ? '10px' : '12px', color: 'white', fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease', boxShadow: '0 4px 20px rgba(59,130,246,0.2)' }}>📤 Post</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Editor;