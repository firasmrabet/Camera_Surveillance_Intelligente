import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Navbar from '../components/Navbar';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Shield, CheckCircle, Filter, Trash2, RefreshCw,
  Clock, Camera, Search, Bell, BellOff, Zap, Eye
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Alerts() {
  const { api } = useAuth();
  const { socket } = useSocket();
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const [alertRes, statsRes] = await Promise.all([
        api.get('/alerts?limit=100'),
        api.get('/alerts/stats/summary')
      ]);
      setAlerts(alertRes.data.alerts);
      setStats(statsRes.data);
    } catch (error) {
      if (error.response?.status === 401) return;
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchAlerts(); }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('global-alert', (alert) => {
      setAlerts(prev => [alert, ...prev]);
      setStats(prev => ({ ...prev, total: (prev.total || 0) + 1, active: (prev.active || 0) + 1, last24h: (prev.last24h || 0) + 1 }));
    });
    return () => socket.off('global-alert');
  }, [socket]);

  const acknowledgeAlert = async (alertId) => {
    try {
      await api.put(`/alerts/${alertId}/acknowledge`);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'acknowledged' } : a));
      toast.success('Alert acknowledged');
    } catch (error) { toast.error('Failed'); }
  };

  const resolveAlert = async (alertId) => {
    try {
      await api.put(`/alerts/${alertId}/resolve`);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'resolved' } : a));
      toast.success('Alert resolved');
    } catch (error) { toast.error('Failed'); }
  };

  const deleteAlert = async (alertId) => {
    try {
      await api.delete(`/alerts/${alertId}`);
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      toast.success('Alert deleted');
    } catch (error) { toast.error('Failed'); }
  };

  const filteredAlerts = alerts.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (searchTerm && !a.type.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const statCards = [
    { label: 'Total', value: stats.total || 0, icon: Bell, color: 'from-indigo-500 to-purple-600' },
    { label: 'Active', value: stats.active || 0, icon: AlertTriangle, color: 'from-red-500 to-pink-600' },
    { label: 'Acknowledged', value: stats.acknowledged || 0, icon: Shield, color: 'from-amber-500 to-orange-600' },
    { label: 'Resolved', value: stats.resolved || 0, icon: CheckCircle, color: 'from-emerald-500 to-cyan-600' },
  ];

  return (
    <div className="min-h-screen bg-[#030712]">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">
              Security <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-red-400">Alerts</span>
            </h1>
            <p className="text-slate-400 mt-2 text-lg">Review and manage all security events</p>
          </div>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={fetchAlerts} className="p-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl border border-slate-700/50">
            <RefreshCw className="w-5 h-5" />
          </motion.button>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10 stagger-children">
          {statCards.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <motion.div key={i} whileHover={{ y: -3, scale: 1.02 }} className="glass rounded-2xl p-5 border border-slate-800/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm font-medium">{stat.label}</p>
                    <p className="text-3xl font-black text-white mt-1">{stat.value}</p>
                  </div>
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
          <div className="flex items-center space-x-1 bg-slate-800/80 rounded-xl p-1 border border-slate-700/50">
            {['all', 'active', 'acknowledged', 'resolved'].map(f => (
              <motion.button
                key={f}
                whileTap={{ scale: 0.95 }}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                  filter === f ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </motion.button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search alerts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-3d w-full pl-10"
            />
          </div>
        </div>

        {/* Alerts List */}
        {loading ? (
          <div className="space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="glass rounded-2xl h-24 animate-pulse border border-slate-800/50" />)}
          </div>
        ) : filteredAlerts.length === 0 ? (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="gradient-border p-16 text-center">
            <BellOff className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-white mb-2">No Alerts</h3>
            <p className="text-slate-400">All clear - no security events to report</p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filteredAlerts.map((alert, i) => (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  transition={{ delay: i * 0.03 }}
                  className={`glass rounded-2xl p-5 border-l-4 ${
                    alert.severity === 'critical' ? 'border-l-red-500' :
                    alert.severity === 'warning' ? 'border-l-amber-500' : 'border-l-blue-500'
                  } border border-slate-800/50 hover:bg-slate-800/20 transition-all group`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        alert.severity === 'critical' ? 'bg-red-500/10 border border-red-500/20' :
                        alert.severity === 'warning' ? 'bg-amber-500/10 border border-amber-500/20' :
                        'bg-blue-500/10 border border-blue-500/20'
                      }`}>
                        <AlertTriangle className={`w-5 h-5 ${
                          alert.severity === 'critical' ? 'text-red-400' :
                          alert.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                        }`} />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-white group-hover:text-indigo-400 transition-colors capitalize">
                          {alert.type.replace(/_/g, ' ')}
                        </h4>
                        <div className="flex items-center space-x-4 mt-1.5 text-xs text-slate-400">
                          <span className="flex items-center"><Camera className="w-3 h-3 mr-1" />{alert.cameraId}</span>
                          <span className="flex items-center"><Clock className="w-3 h-3 mr-1" />{new Date(alert.timestamp).toLocaleString()}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            alert.status === 'active' ? 'bg-red-500/10 text-red-400' :
                            alert.status === 'acknowledged' ? 'bg-amber-500/10 text-amber-400' :
                            'bg-emerald-500/10 text-emerald-400'
                          }`}>{alert.status}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 font-mono">
                          Confidence: {(alert.confidence * 100).toFixed(1)}% {alert.severity && `| ${alert.severity.toUpperCase()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {alert.status === 'active' && (
                        <>
                          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => acknowledgeAlert(alert.id)} className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/20" title="Acknowledge">
                            <Shield className="w-4 h-4" />
                          </motion.button>
                          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => resolveAlert(alert.id)} className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/20" title="Resolve">
                            <CheckCircle className="w-4 h-4" />
                          </motion.button>
                        </>
                      )}
                      {alert.status === 'acknowledged' && (
                        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => resolveAlert(alert.id)} className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/20" title="Resolve">
                          <CheckCircle className="w-4 h-4" />
                        </motion.button>
                      )}
                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => deleteAlert(alert.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
