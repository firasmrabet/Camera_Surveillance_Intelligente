import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Shield, Fingerprint } from 'lucide-react';
import Scene3D from '../components/Scene3D';

export default function Login() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef(null);
  const { loginWithGoogle, login, register, loading } = useAuth();

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setMousePos({ x, y });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = isRegister
        ? await register(email, password, name)
        : await login(email, password);
      if (!result.success) {
        setError(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#030712]">
      <Scene3D variant="login" />

      <div className="absolute inset-0" style={{
        backgroundImage: `
          linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-cyan-600/5 rounded-full blur-[100px]" />

      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          {/* Logo */}
          <motion.div
            initial={{ y: -40, opacity: 0, rotateX: 20 }}
            animate={{ y: 0, opacity: 1, rotateX: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-10"
          >
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-cyan-500 mb-6 shadow-2xl shadow-indigo-500/30 animate-float">
              <Shield className="w-12 h-12 text-white drop-shadow-lg" />
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">
              SENTINEL<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">AI</span>
            </h1>
            <p className="text-slate-400 mt-2 text-lg font-light">Intelligent Security Command Center</p>
          </motion.div>

          {/* Login Card */}
          <motion.div
            ref={cardRef}
            initial={{ y: 60, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transform: `perspective(1000px) rotateY(${mousePos.x * 5}deg) rotateX(${-mousePos.y * 5}deg)`,
              transformStyle: 'preserve-3d'
            }}
            className="gradient-border p-8 relative"
          >
            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
              <p className="text-slate-400 text-sm">{isRegister ? 'Sign up to get started' : 'Sign in to access your security dashboard'}</p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <input
                  type="text"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
              )}
              <input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
              <motion.button
                type="submit"
                disabled={submitting || loading}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl text-base shadow-xl shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {submitting ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
              </motion.button>
            </form>

            {/* Toggle register/login */}
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => { setIsRegister(!isRegister); setError(''); }}
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center my-6">
              <div className="flex-1 border-t border-slate-700/50" />
              <span className="px-4 text-xs text-slate-500 uppercase tracking-wider">or</span>
              <div className="flex-1 border-t border-slate-700/50" />
            </div>

            {/* Google Login Button */}
            <motion.button
              onClick={loginWithGoogle}
              disabled={loading}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-4 bg-white hover:bg-gray-50 text-gray-800 font-bold rounded-xl text-base shadow-xl shadow-black/10 disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group flex items-center justify-center space-x-3 transition-all"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>{loading ? 'Connecting...' : 'Sign in with Google'}</span>
            </motion.button>

            {/* Divider */}
            <div className="flex items-center my-6">
              <div className="flex-1 border-t border-slate-700/50" />
              <span className="px-4 text-xs text-slate-500 uppercase tracking-wider">Secured Access</span>
              <div className="flex-1 border-t border-slate-700/50" />
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { text: 'AI-powered real-time threat detection', color: 'text-indigo-400' },
                { text: 'Per-user dashboard with exclusive cameras', color: 'text-emerald-400' },
                { text: 'Instant alerts via email & SMS with photos', color: 'text-amber-400' },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.1 }}
                  className="flex items-center space-x-3 text-sm"
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${feature.color.replace('text', 'bg')}`} />
                  <span className="text-slate-400">{feature.text}</span>
                </motion.div>
              ))}
            </div>

            {/* Biometric hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="mt-6 flex items-center justify-center space-x-2 text-slate-500 text-sm"
            >
              <Fingerprint className="w-4 h-4" />
              <span>Secured with encrypted authentication</span>
            </motion.div>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center mt-8 text-slate-600 text-sm"
          >
            Powered by advanced neural networks &middot; Real-time threat analysis
          </motion.p>
        </div>
      </div>
    </div>
  );
}
