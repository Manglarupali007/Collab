import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

// Socket instance ko globally rakhein but connection management useEffect mein karein
const socket = io(process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000', {
  autoConnect: false, // Page load pe apne aap connect na ho
});

function Editor() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const username = location.state?.username || localStorage.getItem('username') || 'Anonymous';
  const password = location.state?.password || '';
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [rightTab, setRightSidebarTab] = useState('info'); // 'info', 'tasks', 'analytics'
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUser, setTypingUser] = useState(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState([]);
  const [scheduledTime, setScheduledTime] = useState('');
  const [pollForm, setPollForm] = useState({ question: '', options: ['', ''] });
  const chatEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll chat to bottom whenever a new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    // If token or password (on refresh) is missing, redirect to Home
    if (!token || !password) {
      if (!token) alert("Please login first");
      else alert("Room session expired. Please rejoin.");
      navigate('/');
      return;
    }

    // Sync token with socket instance before connecting
    socket.auth = { token };
    if (socket.io.opts) {
      socket.io.opts.auth = { token };
    }

    const onConnect = () => {
      console.log("Connected to server");
      socket.emit('join-room', { roomId, password });
    };

    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    socket.on('connect', onConnect);
    
    socket.on('message-history', (history) => {
      setChat(history);
    });

    socket.on('user-joined', ({ users: userList, userId: joiningUserId }) => {
      setUsers(userList);
      const joinedUser = userList.find(u => u.id === joiningUserId);
      if (joinedUser && joiningUserId !== socket.id) {
        setChat(prev => [...prev, { id: `sys-${Date.now()}`, system: true, text: `${joinedUser.username} joined the chat` }]);
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

    socket.on('receive-message', (data) => {
      setChat((prev) => [...prev, data]);
      generateSmartReplies(data.text);
    });

    socket.on('update-reactions', ({ messageId, reactions }) => {
      setChat(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    });

    socket.on('message-deleted', (messageId) => {
      setChat((prev) => prev.filter(msg => msg.id !== messageId));
    });

    socket.on('update-poll', ({ messageId, poll }) => {
      setChat(prev => prev.map(msg => msg.id === messageId ? { ...msg, poll } : msg));
    });

    socket.on('task-updated', (updatedTasks) => {
      setTasks(updatedTasks);
    });

    socket.on('pinned-history', (pinned) => {
      setPinnedMessages(pinned);
    });

    socket.on('kicked', () => {
      alert('You have been kicked from the room by the owner.');
      navigate('/');
    });

    socket.on('error', (err) => {
      alert(err);
      navigate('/');
    });

    socket.on('notification', (msg) => {
      alert(msg);
    });

    socket.on('connect_error', (err) => {
      console.error("Connection Error:", err.message);
      if (err.message === "Authentication error" || err.message === "jwt expired") {
        alert("Session expired. Please login again.");
        localStorage.clear();
        navigate('/');
      }
      // Note: We don't alert for other errors to allow socket.io to auto-retry
    });

    return () => {
      // Use a single line to remove all listeners for this room context
      socket.removeAllListeners();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socket.disconnect();
    };
  }, [roomId, username, password, navigate]);

  // Close emoji picker when clicking outside
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

  const handleTyping = (e) => {
    setMessage(e.target.value);
    socket.emit('typing', { roomId, username });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop-typing', { roomId });
    }, 2000);
  };

  const handleEmojiSelect = (emoji) => {
    setMessage(prevMessage => prevMessage + emoji);
    setShowEmojiPicker(false); // Close picker after selection
  };

  const generateSmartReplies = (text) => {
    if (!text) return;
    const t = text.toLowerCase();
    if (t.includes('meeting') || t.includes('call')) {
      setSuggestedReplies(['👍 I will join', 'Sorry, I am busy', 'What time?']);
    } else if (t.includes('hello') || t.includes('hey')) {
      setSuggestedReplies(['Hey there!', 'Hello!', 'How is it going?']);
    } else {
      setSuggestedReplies(['Okay', 'Thanks!', 'Got it']);
    }
  };

  const sendMessage = (e, imageBase64 = null, pollData = null) => {
    if (e) e.preventDefault();
    if (message.trim() || imageBase64 || pollData) {
      if (scheduledTime) {
        const msgData = {
          username,
          text: message,
          scheduledTime,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        socket.emit('schedule-message', { roomId, msgData });
        alert("Message scheduled!");
        setScheduledTime('');
        setMessage('');
        return;
      }

      const msgId = Date.now() + Math.random().toString(36).substr(2, 9);
      const msgData = { 
        id: msgId,
        username, 
        text: message, 
        image: imageBase64,
        isImportant: message.toLowerCase().includes('deadline') || message.includes('http'),
        poll: pollData,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      };
      socket.emit('send-message', { roomId, ...msgData });
      setChat((prev) => [...prev, msgData]);
      setMessage('');
      socket.emit('stop-typing', { roomId });
      setSuggestedReplies([]);
    }
  };

  const addReaction = (messageId, emoji) => {
    socket.emit('add-reaction', { roomId, messageId, emoji });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        sendMessage(e, reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const createPoll = () => {
    const pollData = {
      question: pollForm.question,
      options: pollForm.options.filter(opt => opt.trim() !== '').map(opt => ({ text: opt, votes: 0 }))
    };
    sendMessage(null, null, pollData);
    setShowPollModal(false);
    setPollForm({ question: '', options: ['', ''] });
  };

  const updateTaskStatus = (taskId, newStatus) => {
    socket.emit('update-task-status', { roomId, taskId, newStatus });
  };

  const handleVote = (messageId, optionIndex) => {
    socket.emit('vote', { roomId, messageId, optionIndex });
  };

  const pinMessage = (messageId) => {
    socket.emit('pin-message', { roomId, messageId });
  };

  const deleteMessage = (messageId) => {
    socket.emit('delete-message', { roomId, messageId });
  };

  const kickUser = (userIdToKick) => {
    socket.emit('kick-user', { roomId, userIdToKick });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert("Room ID copied to clipboard!");
  };

  const leaveRoom = () => {
    navigate('/');
  };

  const renderMessageText = (text) => {
    if (!text) return "";
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, index) => {
      if (part.startsWith('http')) {
        return <a key={index} href={part} target="_blank" rel="noreferrer" className="text-blue-400 underline">{part}</a>;
      }
      if (part.startsWith('@')) {
        return (
          <span key={index} className="text-yellow-400 font-bold bg-yellow-400/10 px-1 rounded">
            {part}
          </span>
        );
      }
      return part;
    });
  };
  
  const getStatusColor = (status) => {
    switch(status) {
      case 'away': return 'bg-amber-500';
      case 'busy': return 'bg-rose-500';
      default: return 'bg-emerald-500';
    }
  };

  const getAnalytics = () => {
    const counts = chat.reduce((acc, msg) => {
      if (msg.username) acc[msg.username] = (acc[msg.username] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  const emojis = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '🚀', '💡', '💻', '✅', '❌', '❤️', '💔', '🤔', '🥳', '🤩', '😎', '💯', '✨'];

  const currentUser = users.find(u => u.id === socket.id);
  const isStaff = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  const filteredChat = chat.filter(msg => 
    msg.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-screen bg-[#0f172a] flex flex-col text-[#f1f5f9] font-sans">
      {/* Top Navbar */}
      <div className="bg-[#1e293b]/80 backdrop-blur-md border-b border-white/5 p-4 flex justify-between items-center z-20 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold shadow-lg shadow-blue-500/20">#</div>
          <div>
            <h1 className="font-bold text-md tracking-tight">Private Room: {roomId}</h1>
            <p className="text-[11px] text-[#8696a0]">{users.length} members online</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden lg:block">
            <input 
              type="text" 
              placeholder="Search messages..." 
              className="bg-white/5 text-xs px-4 py-2 rounded-xl border border-white/10 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all w-48"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button onClick={copyRoomId} className="text-xs bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl transition-all font-semibold shadow-lg shadow-blue-600/20">Invite</button>
          <button onClick={leaveRoom} className="text-xs bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-xl border border-red-500/20 text-red-400 transition-all">Exit</button>
        </div>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - User List */}
        <div className="w-64 bg-[#0f172a] border-r border-white/5 hidden md:flex flex-col">
          <div className="p-4 border-b border-white/5">
            <select 
              onChange={(e) => socket.emit('update-status', { roomId, status: e.target.value })}
              className="w-full bg-white/5 text-xs p-2 rounded-lg outline-none border border-white/10"
            >
              <option value="online">🟢 Online</option>
              <option value="away">🟡 Away</option>
              <option value="busy">🔴 Busy</option>
            </select>
          </div>
          <div className="p-4 border-b border-[#222d34]">
            <h2 className="text-[#8696a0] text-xs font-bold uppercase tracking-widest">Participants</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {users.map((user) => (
              <div key={user.id} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-2xl transition-all cursor-default group">
                <div className="relative">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold shadow-sm ${user.role === 'ADMIN' ? 'bg-rose-500/20 text-rose-500' : 'bg-slate-700/50'}`}>
                  {user.username.charAt(0).toUpperCase()}
                  </div>
                  <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[#0f172a] ${getStatusColor(user.status)}`}></div>
                </div>
                <div className="flex-1 flex flex-col">
                  <span className="text-sm font-semibold flex items-center gap-1">
                    {user.username} {user.username === username && "(You)"}
                  </span>
                  <span className={`text-[9px] font-black uppercase tracking-tighter ${user.role === 'ADMIN' ? 'text-rose-400' : user.role === 'MANAGER' ? 'text-indigo-400' : 'text-slate-500'}`}>
                    {user.role}
                  </span>
                </div>
                {isStaff && user.username !== username && (
                  <button 
                    onClick={() => kickUser(user.id)}
                    className="opacity-0 group-hover:opacity-100 text-[9px] bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white px-2 py-1 rounded-lg transition-all"
                  >Kick</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Sidebar - Tabbed Info */}
        <div className="w-80 bg-[#0f172a] border-l border-white/5 flex flex-col">
          <div className="flex border-b border-white/5">
            {['info', 'tasks', 'stats'].map(tab => (
              <button 
                key={tab} 
                onClick={() => setRightSidebarTab(tab)}
                className={`flex-1 p-3 text-[10px] font-black uppercase tracking-widest transition-all ${rightTab === tab ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5' : 'text-slate-500'}`}
              >{tab}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {rightTab === 'info' && (
              <div className="space-y-6">
                <h3 className="text-xs font-bold text-slate-400 uppercase">📌 Pinned Messages</h3>
                {pinnedMessages.map(pm => (
                  <div key={pm.id} className="bg-white/5 p-3 rounded-xl border border-white/5">
                    <p className="text-[11px] text-blue-400 font-bold mb-1">{pm.username}</p>
                    <p className="text-xs text-slate-300 line-clamp-2">{pm.text}</p>
                  </div>
                ))}
              </div>
            )}
            {rightTab === 'tasks' && (
              <div className="space-y-4">
                {['todo', 'doing', 'done'].map(status => (
                  <div key={status} className="space-y-2">
                    <h4 className="text-[10px] font-black uppercase text-slate-500">{status}</h4>
                    {tasks.filter(t => t.status === status).map(task => (
                      <div key={task.id} className="bg-slate-800/50 p-3 rounded-xl border border-white/5 group">
                        <p className="text-xs font-semibold mb-2">{task.title}</p>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {['todo', 'doing', 'done'].filter(s => s !== status).map(s => (
                            <button key={s} onClick={() => updateTaskStatus(task.id, s)} className="text-[9px] bg-white/5 px-2 py-0.5 rounded border border-white/10 hover:bg-blue-600 transition-colors uppercase">{s}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                <button onClick={() => {
                  const title = prompt("Task title?");
                  if(title) socket.emit('create-task', { roomId, task: { title, assignee: username } });
                }} className="w-full py-2 bg-blue-600 rounded-xl text-xs font-bold mt-4">+ New Task</button>
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col relative overflow-hidden bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
          <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-6 pt-4">
              {filteredChat.map((msg, i) => (
                msg.system ? (
                  <div key={msg.id || i} className="flex justify-center">
                    <span className="bg-white/5 text-slate-500 text-[10px] px-4 py-1.5 rounded-full uppercase font-bold tracking-widest border border-white/5">{msg.text}</span>
                  </div>
                ) : (
                  <div key={msg.id || i} className={`flex group ${msg.username === username ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end gap-2 max-w-[85%] ${msg.username === username ? 'flex-row-reverse' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex-shrink-0 flex items-center justify-center text-[10px] font-bold border border-white/10">
                        {msg.username.charAt(0)}
                      </div>
                      <div className={`px-4 py-3 rounded-2xl relative shadow-xl group transition-all hover:ring-1 hover:ring-white/10 ${msg.username === username ? 'bg-gradient-to-br from-blue-600 to-blue-700 rounded-br-none' : 'bg-slate-800 rounded-bl-none'}`}>
                      {msg.username !== username && <p className="text-blue-300 text-[10px] font-black uppercase mb-1 tracking-wider">{msg.username}</p>}
                      {msg.image && <img src={msg.image} alt="shared" className="rounded-xl mb-2 max-w-full max-h-80 object-cover shadow-md" />}
                      {msg.poll && (
                        <div className="bg-black/20 p-4 rounded-xl border border-white/5 mb-2 min-w-[240px]">
                          <p className="font-bold text-sm mb-3 text-blue-400">📊 {msg.poll.question}</p>
                          {msg.poll.options.map((opt, idx) => (
                            <button key={idx} onClick={() => handleVote(msg.id, idx)} className="w-full text-left mb-2 group/btn">
                              <div className="flex justify-between text-[10px] mb-1 px-1 text-slate-300"><span>{opt.text}</span><span>{opt.votes} votes</span></div>
                              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                                <div className="bg-blue-400 h-full transition-all duration-700 ease-out" style={{ width: `${msg.poll.options.reduce((a, b) => a + b.votes, 0) > 0 ? (opt.votes / msg.poll.options.reduce((a, b) => a + b.votes, 0)) * 100 : 0}%` }}></div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                        <p className="text-[14px] leading-relaxed pr-8">{renderMessageText(msg.text)}</p>
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {Object.entries(msg.reactions).map(([e, c]) => (
                              <span key={e} className="bg-black/30 px-1.5 py-0.5 rounded text-[10px]">{e} {c}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1 absolute bottom-1 right-2 opacity-60 group-hover:opacity-100 transition-opacity">
                          <span className="text-[8px]">{msg.time}</span>
                          {msg.username === username && <span className="text-[10px] text-blue-400">✓✓</span>}
                        </div>
                        {/* Reaction Overlay */}
                        <div className="absolute -top-6 right-0 hidden group-hover:flex gap-1 bg-slate-900 p-1 rounded-lg shadow-xl border border-white/10 scale-90 origin-bottom-right">
                          {['👍','❤️','😂','😮'].map(e => (
                            <button key={e} onClick={() => addReaction(msg.id, e)} className="hover:scale-125 transition-transform">{e}</button>
                          ))}
                          {isStaff && <button onClick={() => pinMessage(msg.id)} className="text-[10px] px-1 hover:text-amber-400">📌</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-[#1e293b]/50 backdrop-blur-xl border-t border-white/5 p-4 flex flex-col z-10">
        <div className="flex gap-2 mb-2 ml-12">
          {suggestedReplies.map((reply, i) => (
            <button 
              key={i} 
              onClick={() => { setMessage(reply); sendMessage(null); }}
              className="bg-blue-500/10 text-[10px] text-blue-400 px-3 py-1 rounded-full border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all font-bold"
            >
              {reply}
            </button>
          ))}
        </div>
        {typingUser && (
          <p className="text-[10px] text-emerald-400 font-bold mb-2 ml-12 transition-all flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            {typingUser} is typing...
          </p>
        )}
        <form onSubmit={sendMessage} className="flex items-center gap-3 max-w-5xl mx-auto w-full">
          <label className="cursor-pointer text-slate-400 hover:text-blue-400 transition p-2 rounded-xl hover:bg-white/5">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V4.35c0-2.001-1.53-3.531-3.531-3.531S8.469 2.35 8.469 4.35v7.061c0 2.001 1.53 3.531 3.53 3.531zm6.235-3.531c0 3.531-2.942 6.002-6.235 6.002s-6.235-2.471-6.235-6.002H3.705c0 4.001 3.177 7.296 7.061 7.767V23.5h2.467v-4.324c3.884-.471 7.061-3.766 7.061-7.767h-2.059z"></path>
            </svg>
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          <div className="relative" ref={emojiPickerRef}>
              <button
                  type="button"
                  onClick={() => setShowEmojiPicker(prev => !prev)}
                  className="text-slate-400 hover:text-amber-400 transition p-2 rounded-xl hover:bg-white/5"
                  title="Choose emoji"
              >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 22C6.486 22 2 17.514 2 12S6.486 2 12 2s10 4.486 10 10-4.486 10-10 10zM8 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-4 8c-2.206 0-4-1.794-4-4h2c0 1.103.897 2 2 2s2-.897 2-2h2c0 2.206-1.794 4-4 4z"/>
                  </svg>
              </button>
              {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-4 bg-slate-800 border border-white/10 rounded-2xl shadow-2xl p-3 grid grid-cols-5 gap-1 z-50 animate-in fade-in slide-in-from-bottom-2">
                      {emojis.map((emoji, index) => (
                          <button key={index} type="button" onClick={() => handleEmojiSelect(emoji)} className="p-2 text-xl hover:bg-white/10 rounded-xl transition-all hover:scale-125">
                              {emoji}
                          </button>
                      ))}
                  </div>
              )}
          </div>
          <input 
            type="datetime-local" 
            className="bg-white/5 text-[9px] text-slate-400 outline-none w-32 border border-white/5 rounded-lg px-2 py-1"
            value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
          />
          <input 
            type="text" 
            value={message}
            onChange={handleTyping}
            placeholder="Type a message"
            className="flex-1 bg-white/5 text-[#f1f5f9] px-5 py-3 rounded-2xl outline-none placeholder-slate-500 text-sm border border-white/10 focus:border-blue-500/50 transition-all"
          />
          <button type="submit" className="bg-blue-600 p-3 rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/30 active:scale-95">
             <svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" fill="white">
              <path d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845L1.101,21.757z"></path>
            </svg>
          </button>
        </form>
      </div>

      {/* Create Poll Modal */}
      {showPollModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 p-8 rounded-3xl w-full max-w-md border border-white/10 shadow-2xl scale-in">
            <h2 className="text-xl font-bold mb-4">Create a Poll</h2>
            <input 
              placeholder="Question" 
              className="w-full bg-white/5 p-3 rounded-2xl mb-4 outline-none border border-white/5 focus:border-blue-500 transition-all"
              value={pollForm.question} onChange={e => setPollForm({...pollForm, question: e.target.value})}
            />
            {pollForm.options.map((opt, i) => (
              <input 
                key={i} placeholder={`Option ${i+1}`} 
                className="w-full bg-white/5 p-3 rounded-2xl mb-2 outline-none border border-white/5 text-sm"
                value={opt} onChange={e => {
                  const newOpts = [...pollForm.options];
                  newOpts[i] = e.target.value;
                  setPollForm({...pollForm, options: newOpts});
                }}
              />
            ))}
            <button className="text-blue-400 text-xs font-bold mb-6 hover:text-blue-300 transition-colors" onClick={() => setPollForm({...pollForm, options: [...pollForm.options, '']})}>+ Add Option</button>
            <div className="flex gap-2">
              <button onClick={() => setShowPollModal(false)} className="flex-1 py-3 bg-white/5 rounded-2xl hover:bg-white/10 transition-all font-bold">Cancel</button>
              <button onClick={createPoll} className="flex-1 py-3 bg-blue-600 rounded-2xl hover:bg-blue-500 transition-all font-bold shadow-lg shadow-blue-600/20">Post Poll</button>
            </div>
          </div>
        </div>
      )}

      <button 
        onClick={() => setShowPollModal(true)}
        className="fixed bottom-24 right-6 bg-blue-600 p-3 rounded-full shadow-lg hover:scale-110 transition"
        title="Create Poll"
      >
        📊
      </button>
    </div>
  );
}

export default Editor;