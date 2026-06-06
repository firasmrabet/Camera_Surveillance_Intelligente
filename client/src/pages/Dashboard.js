import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Navbar from '../components/Navbar';
import CameraCard from '../components/CameraCard';
import Scene3DMini from '../components/Scene3DMini';
import AddCameraModal from '../components/AddCameraModal';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, AlertTriangle, Shield, Activity, TrendingUp,
  Plus, X, RefreshCw, Zap, Eye, Clock, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import AlertConfirmation from '../components/AlertConfirmation';

export default function Dashboard() {
  const { api } = useAuth();
  const { socket } = useSocket();
  const [cameras, setCameras] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, alerts: 0, last24h: 0 });
  const [alerts, setAlerts] = useState([]);
  const [showAddCamera, setShowAddCamera] = useState(false);
  const [newCamera, setNewCamera] = useState({ name: '', location: '', url: '' });
  const [loading, setLoading] = useState(true);
  const [pendingAlert, setPendingAlert] = useState(null);

  const fetchCameras = useCallback(async () => {
    try {
      const response = await api.get('/cameras');
      setCameras(response.data);
      const activeCount = response.data.filter(c => c.status === 'online').length;
      setStats(prev => ({ ...prev, total: response.data.length, active: activeCount }));
    } catch (error) {
      if (error.response?.status === 401) return;
      console.error('Failed to fetch cameras:', error);
    }
  }, [api]);

  const fetchAlerts = useCallback(async () => {
    try {
      const [alertRes, statsRes] = await Promise.all([
        api.get('/alerts?limit=10'),
        api.get('/alerts/stats/summary')
      ]);
      setAlerts(alertRes.data.alerts);
      setStats(prev => ({ ...prev, alerts: statsRes.data.total, last24h: statsRes.data.last24h }));
    } catch (error) {
      if (error.response?.status === 401) return;
      console.error('Failed to fetch alerts:', error);
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchCameras(), fetchAlerts()]);
      } catch (_) { /* handled in callbacks */ }
      if (!cancelled) setLoading(false);
    };
    load();
    // Failsafe: never stay loading for more than 4s
    const failsafe = setTimeout(() => { if (!cancelled) setLoading(false); }, 4000);
    return () => { cancelled = true; clearTimeout(failsafe); };
  }, [fetchCameras, fetchAlerts]);

  useEffect(() => {
    if (!socket) return;
    const onGlobalAlert = (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 10));
      setStats(prev => ({ ...prev, alerts: prev.alerts + 1, last24h: prev.last24h + 1 }));
      if (alert.details?.requiresHuman) {
        setPendingAlert(alert);
      }
    };
    socket.on('global-alert', onGlobalAlert);
    return () => socket.off('global-alert', onGlobalAlert);
  }, [socket]);

  const handleAddCamera = async (e) => {
    e.preventDefault();
    try {
      await api.post('/cameras', newCamera);
      toast.success('Camera added successfully');
      setShowAddCamera(false);
      setNewCamera({ name: '', location: '', url: '' });
      fetchCameras();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add camera');
    }
  };

  const handleDeleteCamera = async (cameraId) => {
    // Optimistic update — remove from UI immediately
    const previous = cameras;
    setCameras(prev => prev.filter(c => c.id !== cameraId));
    setStats(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    try {
      await api.delete(`/cameras/${cameraId}`);
      toast.success('Camera deleted');
    } catch (error) {
      // Rollback on failure
      setCameras(previous);
      toast.error(error.response?.data?.error || 'Failed to delete camera');
    }
  };

  const statCards = [
    { label: 'Total Cameras', value: stats.total, icon: Camera, gradient: 'from-indigo-500 to-purple-600', shadow: 'shadow-indigo-500/20' },
    { label: 'Online Now', value: stats.active, icon: Activity, gradient: 'from-emerald-500 to-cyan-600', shadow: 'shadow-emerald-500/20' },
    { label: 'Total Alerts', value: stats.alerts, icon: AlertTriangle, gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/20' },
    { label: 'Last 24h', value: stats.last24h, icon: TrendingUp, gradient: 'from-red-500 to-pink-600', shadow: 'shadow-red-500/20' },
  ];

  const handleConfirmAlert = (alert) => {
    setPendingAlert(null);
    toast.error('POLICE APPELÉE ! Action confirmée depuis le Dashboard.', { duration: 5000, icon: '🚨' });
  };

  const handleDismissAlert = (alert) => {
    setPendingAlert(null);
    toast.success('Alerte ignorée.');
  };

  return (
    <div className="min-h-screen bg-[#030712] relative">
      <Scene3DMini />
      
      <AnimatePresence>
        {pendingAlert && (
          <AlertConfirmation 
            alert={pendingAlert} 
            onConfirm={handleConfirmAlert} 
            onDismiss={handleDismissAlert} 
          />
        )}
      </AnimatePresence>

      <div className="relative z-10">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center justify-between mb-10"
          >
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight">
                Security <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Command Center</span>
              </h1>
              <p className="text-slate-400 mt-2 text-lg">Real-time monitoring and AI threat detection</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.05, rotate: 180 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { window.location.href = '/'; }}
              title="Hard reload dashboard"
              className="p-3 bg-slate-800/80 hover:bg-slate-700 text-white rounded-xl border border-slate-700/50"
            >
              <RefreshCw className="w-5 h-5" />
            </motion.button>
          </motion.div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10 stagger-children">
            {statCards.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={i}
                  whileHover={{ y: -5, scale: 1.03 }}
                  className={`glass rounded-2xl p-6 relative overflow-hidden group cursor-pointer border border-slate-800/50`}
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br opacity-10 rounded-full -mr-10 -mt-10 group-hover:opacity-20 transition-opacity"
                    style={{ backgroundImage: `linear-gradient(135deg, var(--primary), transparent)` }}
                  />
                  <div className="flex items-center justify-between relative z-10">
                    <div>
                      <p className="text-slate-400 text-sm font-medium">{stat.label}</p>
                      <motion.p
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: i * 0.1, type: 'spring', stiffness: 200 }}
                        className="text-4xl font-black text-white mt-2"
                      >
                        {stat.value}
                      </motion.p>
                    </div>
                    <motion.div
                      whileHover={{ rotate: 360, scale: 1.2 }}
                      transition={{ duration: 0.6 }}
                      className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-xl ${stat.shadow}`}
                    >
                      <Icon className="w-7 h-7 text-white" />
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Cameras Section */}
          <div className="flex items-center justify-between mb-8">
            <motion.h2
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-2xl font-bold text-white flex items-center"
            >
              <Eye className="w-6 h-6 mr-3 text-indigo-400" />
              Surveillance Cameras
            </motion.h2>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddCamera(true)}
              className="flex items-center px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Camera
            </motion.button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="glass rounded-2xl h-96 animate-pulse">
                  <div className="h-full bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : cameras.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="gradient-border p-16 text-center"
            >
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Camera className="w-20 h-20 text-slate-600 mx-auto mb-6" />
              </motion.div>
              <h3 className="text-2xl font-bold text-white mb-3">No Cameras Configured</h3>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">Add your first camera to begin AI-powered security monitoring</p>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowAddCamera(true)}
                className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-lg shadow-xl shadow-indigo-500/30"
              >
                <Plus className="w-5 h-5 mr-2 inline" />
                Add Your First Camera
              </motion.button>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {cameras.map((camera, i) => (
                <motion.div
                  key={camera.id}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <CameraCard camera={camera} alertCount={alerts.filter(a => a.cameraId === camera.id).length} onDelete={handleDeleteCamera} />
                </motion.div>
              ))}
            </div>
          )}

          {/* Recent Alerts */}
          {alerts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-12"
            >
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
                <Zap className="w-6 h-6 mr-3 text-amber-400" />
                Recent Security Events
              </h2>
              <div className="glass rounded-2xl overflow-hidden border border-slate-800/50">
                <div className="divide-y divide-slate-800/50">
                  {alerts.slice(0, 5).map((alert, i) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-5 flex items-center justify-between hover:bg-slate-800/30 transition-all group"
                    >
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          alert.severity === 'critical' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          alert.severity === 'warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors capitalize">
                            {alert.type.replace(/_/g, ' ')}
                          </p>
                          <div className="flex items-center space-x-3 mt-1 text-xs text-slate-400">
                            <span className="flex items-center"><Clock className="w-3 h-3 mr-1" />{new Date(alert.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                          alert.status === 'active' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          alert.status === 'acknowledged' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {alert.status}
                        </span>
                        <span className="text-sm font-mono text-slate-400">
                          {(alert.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Add Camera Modal */}
          <AddCameraModal
            isOpen={showAddCamera}
            onClose={() => setShowAddCamera(false)}
            onAdded={(cam) => {
              setCameras(prev => [...prev, cam]);
              setShowAddCamera(false);
            }}
          />
        </main>
      </div>
    </div>
  );
}
