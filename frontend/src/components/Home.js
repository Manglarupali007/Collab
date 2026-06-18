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
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) setIsLoggedIn(true);
  }, []);

  const handleAuth = async () => {
    setLoading(true);
    try {
      const endpoint = isSignup ? '/api/register' : '/api/login';
      const res = await axios.post(`${process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000'}${endpoint}`, { username, password });
      
      if (isSignup) {
        alert("Swagat hai! Registration safal raha. Ab login karein.");
        setIsSignup(false);
      } else {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('username', res.data.username);
        setIsLoggedIn(true);
      }
    } catch (err) {
      alert(err.response?.data?.error || "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setIsLoggedIn(false);
  };

  const createRoom = () => {
    const roomPass = prompt("Set a password for this private room:");
    if(!roomPass) {
      alert("Room password is required");
      return;
    }
    const id = uuidv4().slice(0, 8);
    navigate(`/editor/${id}`, { state: { username: localStorage.getItem('username'), password: roomPass } });
  };

  const joinRoom = () => {
    const roomPass = prompt("Enter room password:");
    if(!roomId || !roomPass) {
      alert("Room ID and password are required");
      return;
    }
    navigate(`/editor/${roomId}`, { state: { username: localStorage.getItem('username'), password: roomPass } });
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/20 blur-[120px] rounded-full"></div>

      <div className="backdrop-blur-xl bg-white/5 p-8 rounded-3xl shadow-2xl w-full max-w-[400px] border border-white/10 relative z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-emerald-500 mb-4 shadow-lg shadow-blue-500/20">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </div>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            SecureChat
          </h1>
          <p className="text-gray-400 text-xs font-medium uppercase tracking-[0.2em]">Encrypted Collaboration</p>
        </div>

        <div className="space-y-5">
          {!isLoggedIn ? (
            <>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-blue-500 transition-colors">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                </div>
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                />
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-blue-500 transition-colors">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                />
              </div>
              <button
                onClick={handleAuth}
                disabled={loading}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-2xl text-white font-bold transition-all shadow-lg shadow-blue-500/25 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Processing...' : (isSignup ? 'Create Account' : 'Sign In')}
              </button>
              <button
                type="button"
                className="w-full text-center text-sm text-gray-500 hover:text-white transition-colors py-2"
                onClick={() => setIsSignup(!isSignup)}
              >
                {isSignup ? "Already a member? Login" : "New here? Create an account"}
              </button>
            </>
          ) : (
            <>
              <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl mb-4 text-center">
                <p className="text-gray-400 text-xs mb-1">Authenticated as</p>
                <p className="text-blue-400 font-bold text-lg">{localStorage.getItem('username')}</p>
              </div>
              
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] text-gray-500 uppercase font-bold ml-1 tracking-widest">Join Existing Room</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter Room ID"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-all text-sm"
                    />
                    <button onClick={joinRoom} className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-2xl text-white font-bold transition-all active:scale-95 shadow-lg shadow-blue-600/20">
                      Join
                    </button>
                  </div>
                </div>

                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-gray-600 font-bold"><span className="bg-[#161f31] px-2">Or</span></div>
                </div>

                <button onClick={createRoom} className="w-full py-4 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-600/30 rounded-2xl text-emerald-400 font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"></path></svg>
                  Create Private Space
                </button>
              </div>

              <div className="pt-6">
                <button 
                  onClick={handleLogout} 
                  className="w-full py-2 text-gray-500 text-xs hover:text-red-400 transition-colors flex items-center justify-center gap-1 group"
                >
                  <svg className="group-hover:translate-x-[-2px] transition-transform" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path></svg>
                  Sign out from device
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Home;