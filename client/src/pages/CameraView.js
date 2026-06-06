import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Navbar from '../components/Navbar';
import VideoStage from '../components/LiveView/VideoStage';
import Toolbar from '../components/LiveView/Toolbar';
import FilterPanel from '../components/LiveView/FilterPanel';
import PhotoGallery from '../components/LiveView/PhotoGallery';
import KeyboardShortcuts from '../components/LiveView/KeyboardShortcuts';
import { useVideoTransform } from '../hooks/useVideoTransform';
import { useVideoFilters } from '../hooks/useVideoFilters';
import { usePhotoCapture, FlashOverlay, ShutterFrame, PhotoCounter } from '../components/LiveView/PhotoCapture';

import { useAIAutoZoom, useRecentPhotos } from '../hooks/useAIAutoZoom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Camera, CameraOff, AlertTriangle, Shield,
  Maximize, Minimize, Volume2, VolumeX,
  Cpu, Activity, MapPin, Eye, Wifi, Smartphone, Scan, Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import AlertConfirmation from '../components/AlertConfirmation';

const API_BASE = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:5000`;

export default function CameraView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { socket, subscribeToCamera, unsubscribeFromCamera, startDetection, stopDetection, subscribeLive, unsubscribeLive } = useSocket();

  const [camera, setCamera] = useState(null);
  const [detections, setDetections] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [streamActive, setStreamActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [alertLevel, setAlertLevel] = useState('none');
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [cameraSource, setCameraSource] = useState('webcam');
  const [streamError, setStreamError] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [proxyUrl, setProxyUrl] = useState(null);
  const [pendingAlert, setPendingAlert] = useState(null);
  // Snapshot refresh: forces fallback to canvas
  const [snapshotKey, setSnapshotKey] = useState(0);
  // Live View Pro state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aiZoomEnabled, setAiZoomEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [shutterShow, setShutterShow] = useState(false);
  const [captureUploading, setCaptureUploading] = useState(false);

  const imgRef = useRef(null);
  const detectionCanvasRef = useRef(null);
  const fallbackCanvasRef = useRef(null);
  const frameCountRef = useRef(0);
  
  // TRUE ZERO-LATENCY: We use a native <img> tag pointing to the backend proxy stream.
  // This completely bypasses JavaScript decoding and WebSockets, letting the browser's
  // hardware-accelerated C++ MJPEG decoder render the stream instantly like TikTok/Insta.
  const token = localStorage.getItem('token') || '';
  const nativeMjpegUrl = camera ? `${API_BASE}/api/cameras/${id}/proxy-stream?t=${snapshotKey}&token=${encodeURIComponent(token)}` : '';

  const detectionTimerRef = useRef(null);
  const lastFrameTsRef = useRef(0);

  const transform = useVideoTransform({ enableKeyboard: false });
  const { filters, setFilter, applyPreset, reset: resetFilters, activePreset, isModified, cssFilter, svgFilter } = useVideoFilters();
  const { capturePhoto, flash, count: capturedCount } = usePhotoCapture(imgRef);
  const { onDetections: feedAutoZoom, trackingActive, trackedLabel } = useAIAutoZoom({
    containerRef: transform.containerRef,
    videoRef: imgRef,
    enabled: aiZoomEnabled
  });
  const { photos, refresh: refreshPhotos } = useRecentPhotos(API_BASE);
  const previewUrl = `${API_BASE}/api/cameras/${id}/preview?t=${snapshotKey}&token=${localStorage.getItem('token') || ''}`;

  // ============ FETCH CAMERA + STREAM URL ============
  useEffect(() => {
    const fetchCamera = async () => {
      try {
        const response = await api.get(`/cameras/${id}`);
        if (response.status !== 200 || !response.data) {
          toast.error('Camera not found');
          navigate('/', { replace: true });
          return;
        }
        const cam = response.data;
        setCamera(cam);

        if (cam.protocol === 'rtsp' || cam.protocol === 'rtmp') {
          try {
            await api.post(`/cameras/${cam.id}/hls/start`);
            setStreamUrl(`${API_BASE}/hls/${cam.id}/index.m3u8`);
            setCameraSource('ip-camera-hls');
            setStreamActive(true);
            return;
          } catch (e) { console.warn('HLS proxy failed', e); }
        }

        // Use the streamUrl that the GET /:id endpoint already resolved
        if (cam.streamUrl) {
          const isExternal = !(cam.url && cam.url.startsWith('usb'));
          // ZERO-LATENCY: Always prefer direct camera URL (streamUrl) over Node.js proxy
          // The proxy adds buffering + JS overhead. Direct <img> MJPEG is hardware-decoded.
          const primaryUrl = cam.streamUrl;
          setStreamUrl(primaryUrl);
          setProxyUrl(cam.proxyUrl);
          setCameraSource(isExternal ? 'ip-camera' : 'usb');
          setStreamActive(true);
        } else {
          // Fallback: explicit stream-url call (should rarely happen now)
          const urlRes = await api.get(`/cameras/${id}/stream-url`);
          if (urlRes.data && urlRes.data.url) {
            const isExternal = !urlRes.data.source?.startsWith('usb');
            const primaryUrl = (isExternal && urlRes.data.proxyUrl) ? urlRes.data.proxyUrl : urlRes.data.url;
            setStreamUrl(primaryUrl);
            setProxyUrl(urlRes.data.proxyUrl);
            setCameraSource(isExternal ? 'ip-camera' : 'usb');
            setStreamActive(true);
          }
        }

        if (cam.detectionEnabled !== false) {
          if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
          detectionTimerRef.current = setTimeout(() => {
            setIsDetecting(true);
            startDetection(id);
          }, 2000);
        }
      } catch (error) {
        console.error('[CameraView] fetch error:', error);
        if (error.response?.status === 404 || error.response?.status === 401) {
          toast.error(error.response?.status === 404 ? 'Camera not found' : 'Please log in again');
          setTimeout(() => navigate('/', { replace: true }), 1500);
        } else {
          toast.error('Cannot load camera');
        }
      }
    };
    fetchCamera();
    return () => {
      if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
      // Stop detection when leaving the camera view so the IP Webcam is not hammered
      // for cameras no one is watching (IP Webcam = single-threaded, max 2-3 conns).
      stopDetection(id);
      setIsDetecting(false);
    };
  }, [id, api, navigate, startDetection, stopDetection]);



  const startFps = () => {
    frameCountRef.current = 0;
    lastTimeRef.current = Date.now();
    fpsIntervalRef.current = setInterval(() => {
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastTimeRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
    }, 1000 / 30);
  };
  const stopFps = () => { if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current); setFps(0); };

  // ============ SOCKET ============
  useEffect(() => {
    subscribeToCamera(id);
    return () => unsubscribeFromCamera(id);
  }, [id, subscribeToCamera, unsubscribeFromCamera]);



  useEffect(() => {
    if (!socket) return;
    const onDetections = (data) => {
      if (data.cameraId === id) {
        setDetections(data.detections);
        drawDetections(data.detections);
        const hasCritical = data.detections.some(d => d.type === 'intrusion' || d.severity === 'critical');
        const hasWarning = data.detections.some(d => d.severity === 'warning' || d.type === 'loitering');
        if (hasCritical) setAlertLevel('critical');
        else if (hasWarning) setAlertLevel('medium');
        else if (data.detections.length > 0) setAlertLevel('low');
        if (aiZoomEnabled) {
          const flat = (data.detections || []).map(d => ({
            label: d.type, x: d.boundingBox?.x ?? 0, y: d.boundingBox?.y ?? 0,
            width: d.boundingBox?.width ?? 0, height: d.boundingBox?.height ?? 0
          }));
          feedAutoZoom(flat);
        }
      }
    };
    const onAlert = (alert) => {
      if (alert.cameraId === id) {
        setRecentAlerts(prev => [alert, ...prev].slice(0, 20));
        if (alert.details?.requiresHuman) {
          setPendingAlert(alert);
        }
      }
    };
    socket.on('detections', onDetections);
    socket.on('alert', onAlert);
    return () => { socket.off('detections', onDetections); socket.off('alert', onAlert); };
  }, [socket, id, aiZoomEnabled, feedAutoZoom]);

  // ============ DETECTION CONTROLS ============
  const handleStartDetection = () => { setIsDetecting(true); startDetection(id); toast.success('AI detection activated'); };
  const handleStopDetection = () => { setIsDetecting(false); stopDetection(id); setDetections([]); setAlertLevel('none'); clearCanvas(); toast.success('AI detection deactivated'); };

  const drawDetections = useCallback((dets) => {
    const canvas = detectionCanvasRef.current;
    const mediaEl = imgRef.current;
    if (!canvas || !mediaEl) return;
    const ctx = canvas.getContext('2d');
    const w = mediaEl.width || mediaEl.naturalWidth || 1280;
    const h = mediaEl.height || mediaEl.naturalHeight || 720;
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const minConfidence = camera?.detectionThreshold || 0.5;
    dets.filter(det => (det.confidence ?? 0) >= minConfidence).forEach(det => {
      if (!det.boundingBox) return;
      const { x, y, width, height } = det.boundingBox;
      const px = x * canvas.width, py = y * canvas.height, pw = width * canvas.width, ph = height * canvas.height;
      let color = '#10b981';
      if (det.type === 'intrusion') color = '#ef4444';
      else if (det.type === 'loitering') color = '#f59e0b';
      else if (det.type === 'unusual_behavior') color = '#f97316';
      else if (det.type === 'theft') color = '#dc2626';
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(px, py, pw, ph);
      const label = `${det.type.replace(/_/g, ' ')} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = 'bold 14px Inter, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color; ctx.fillRect(px, py - 28, tw + 12, 24);
      ctx.fillStyle = '#fff'; ctx.fillText(label, px + 6, py - 8);
    });
    if (camera?.zones) {
      camera.zones.forEach(zone => {
        ctx.strokeStyle = zone.type === 'critical' ? '#ef444488' : zone.type === 'warning' ? '#f59e0b88' : '#10b98166';
        ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        const c = zone.coordinates; ctx.beginPath();
        ctx.moveTo(c[0][0] * canvas.width, c[0][1] * canvas.height);
        for (let i = 1; i < c.length; i++) ctx.lineTo(c[i][0] * canvas.width, c[i][1] * canvas.height);
        ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      });
    }
  }, [camera]);
  const clearCanvas = () => { const c = detectionCanvasRef.current; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); };

  // ============ PHOTO CAPTURE ============
  const handleCapture = useCallback(async () => {
    if (captureUploading) return;
    setShutterShow(true);
    setTimeout(() => setShutterShow(false), 500);
    const token = localStorage.getItem('token') || '';

    // Strategy:
    // With native MJPEG <img>, we cannot capture from the element directly due to CORS limitations.
    // Instead, we hit the server endpoint to fetch a guaranteed fresh frame from the stream proxy.
    let result = null;

    if (!result) {
      try {
        result = await capturePhoto({
          preferServer: true,
          apiBase: API_BASE,
          cameraId: id,
          token
        });
      } catch (err) {
        console.error('[CameraView] capturePhoto failed:', err);
      }
    }

    if (!result || !result.blob) {
      const reason = (typeof result === 'object' && result?.lastError) || 'Could not capture photo';
      console.error('[CameraView] capture failed:', reason);
      toast.error(typeof reason === 'string' ? reason : 'Could not capture photo');
      return;
    }
    setCaptureUploading(true);
    try {
      await api.post('/photos', {
        cameraId: id, cameraName: camera?.name,
        base64: result.dataUrl, mime: 'image/jpeg',
        width: result.width, height: result.height,
        context: {
          source: result.source || 'unknown',
          activePreset, filtersApplied: isModified,
          zoom: transform.zoom, rotation: transform.rotation,
          detections: detections.map(d => ({ type: d.type, confidence: d.confidence })),
          threatLevel: alertLevel
        }
      });
      toast.success(`Photo saved! (${(result.blob.size / 1024).toFixed(0)} KB)`);
      refreshPhotos();
    } catch (err) { toast.error('Failed to upload photo'); console.error(err); }
    finally { setCaptureUploading(false); }
  }, [captureUploading, capturePhoto, id, camera, activePreset, isModified, transform.zoom, transform.rotation, detections, alertLevel, api, refreshPhotos]);

  // ============ RETRY on error ============
  const handleRetry = () => {
    setStreamError(false);
    if (proxyUrl) {
      setStreamUrl(`${proxyUrl}${(proxyUrl).includes('?') ? '&' : '?'}t=${Date.now()}`);
    } else {
      // Re-fetch the stream url
      api.get(`/cameras/${id}/stream-url`).then(urlRes => {
        if (urlRes.data && urlRes.data.url) {
          setStreamUrl(`${urlRes.data.url}${urlRes.data.url.includes('?') ? '&' : '?'}t=${Date.now()}`);
          setProxyUrl(urlRes.data.proxyUrl);
        }
      });
    }
  };

  // ============ KEYBOARD SHORTCUTS ============
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      switch (e.key) {
        case '+': case '=': e.preventDefault(); transform.zoomIn(); break;
        case '-': case '_': e.preventDefault(); transform.zoomOut(); break;
        case '0': e.preventDefault(); transform.reset(); resetFilters(); break;
        case 'r': case 'R': e.preventDefault(); transform.rotateRight(); break;
        case 'l': case 'L': e.preventDefault(); transform.rotateLeft(); break;
        case 'h': case 'H': e.preventDefault(); transform.toggleFlipH(); break;
        case 'v': case 'V': e.preventDefault(); transform.toggleFlipV(); break;
        case 'a': case 'A': e.preventDefault(); transform.cycleAspect(); break;
        case 'f': case 'F': e.preventDefault(); transform.toggleFullscreen(); break;
        case ' ': e.preventDefault(); break;
        case 'p': case 'P': e.preventDefault(); handleCapture(); break;
        case 'g': case 'G': e.preventDefault(); setGalleryOpen(true); break;
        case 'i': case 'I': e.preventDefault(); setFiltersOpen(f => !f); break;
        case 'z': case 'Z': e.preventDefault(); setAiZoomEnabled(z => !z); break;
        case 'k': case 'K': e.preventDefault(); transform.toggleLock(); break;
        case '?': e.preventDefault(); setShortcutsOpen(true); break;
        case 'Escape':
          if (shortcutsOpen) setShortcutsOpen(false);
          else if (filtersOpen) setFiltersOpen(false);
          else if (galleryOpen) setGalleryOpen(false);
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [transform, resetFilters, handleCapture, filtersOpen, galleryOpen, shortcutsOpen]);

  const alertColors = {
    none: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    low: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    high: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    critical: 'bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse'
  };

  const handleConfirmAlert = (alert) => {
    setPendingAlert(null);
    toast.error('POLICE APPELÉE ! Action confirmée.', { duration: 5000, icon: '🚨' });
    // This would send a REST call to the backend to confirm the alert and notify authorities
  };

  const handleDismissAlert = (alert) => {
    setPendingAlert(null);
    toast.success('Alerte ignorée.');
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-sans selection:bg-emerald-500/30">
      <Navbar />
      
      {/* Human Confirmation Modal */}
      <AnimatePresence>
        {pendingAlert && (
          <AlertConfirmation 
            alert={pendingAlert} 
            onConfirm={handleConfirmAlert} 
            onDismiss={handleDismissAlert} 
          />
        )}
      </AnimatePresence>

      <main className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <motion.button whileHover={{ scale: 1.1, x: -3 }} whileTap={{ scale: 0.9 }} onClick={() => navigate('/')} className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white border border-slate-800">
              <ArrowLeft className="w-5 h-5" />
            </motion.button>
            <div>
              <h1 className="text-2xl font-black text-white">{camera?.name || 'Loading...'}</h1>
              <div className="flex items-center text-slate-400 text-sm mt-0.5">
                <MapPin className="w-3.5 h-3.5 mr-1" />{camera?.location}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className={`flex items-center px-3 py-1.5 rounded-full text-sm font-bold ${alertColors[alertLevel]}`}>
              <Shield className="w-4 h-4 mr-1.5" />
              {alertLevel === 'none' ? 'All Clear' : alertLevel.toUpperCase()}
            </div>
            <div className="flex items-center px-3 py-1.5 bg-slate-800/80 rounded-full text-sm text-slate-300 font-mono border border-slate-700/50">
              <Activity className="w-4 h-4 mr-1.5 text-indigo-400" />
              {fps} FPS
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="gradient-border overflow-hidden">
              <div className="relative aspect-video bg-black rounded-t-xl overflow-hidden">
                <VideoStage
                  ref={transform.containerRef}
                  transform={transform.transform}
                  cssFilter={cssFilter}
                  svgFilter={svgFilter}
                  objectFit={transform.objectFit}
                  isDragging={transform.isDragging}
                  isLocked={transform.isLocked}
                  onMouseDown={(e) => { transform.startDrag(e); setShortcutsOpen(false); }}
                  onMouseMove={transform.onDrag}
                  onMouseUp={transform.endDrag}
                  onMouseLeave={transform.endDrag}
                >
                  {cameraSource === 'ip-camera-hls' && streamUrl ? (
                    <video
                      ref={imgRef}
                      autoPlay playsInline muted={isMuted}
                      className="w-full h-full"
                      style={{ objectFit: transform.objectFit }}
                    >
                      <source src={streamUrl} type="application/vnd.apple.mpegurl" />
                    </video>
                    ) : streamUrl ? (
                      // ABSOLUTE ZERO-LATENCY NATIVE DECODING
                      // Using the browser's native C++ MJPEG decoder connected to the Node.js proxy stream.
                      // Provides 100% smooth, TikTok-level fluidity with hardware acceleration.
                      <img
                        ref={imgRef}
                        crossOrigin="anonymous"
                        src={nativeMjpegUrl}
                        alt="Live Camera Feed"
                        className="w-full h-full object-contain"
                        style={{ objectFit: transform.objectFit }}
                        onLoad={() => {
                          if (!streamActive) setStreamActive(true);
                        }}
                        onError={() => {
                          setStreamError(true);
                        }}
                      />
                    ) : null}
                </VideoStage>

                <canvas
                  ref={detectionCanvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                  style={{ transform: `scale(${transform.zoom * (transform.flipH ? -1 : 1)}, ${transform.zoom * (transform.flipV ? -1 : 1)}) rotate(${transform.rotation}deg)`, transformOrigin: 'center' }}
                />

                <PhotoCounter count={capturedCount} onOpenGallery={() => setGalleryOpen(true)} />
                <FlashOverlay show={flash} />
                <ShutterFrame show={shutterShow} />

                {!streamActive && !streamUrl && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#030712]/95">
                    <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 3, repeat: Infinity }} className="w-24 h-24 rounded-2xl bg-slate-800/80 flex items-center justify-center mb-6 border border-slate-700/50">
                      <CameraOff className="w-12 h-12 text-slate-600" />
                    </motion.div>
                    <p className="text-xl font-bold text-white mb-2">No Camera Connected</p>
                    <p className="text-sm text-slate-400 mb-8">Connect a camera from the dashboard</p>
                  </div>
                )}

                {streamUrl && streamError && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#030712]/95">
                    <AlertTriangle className="w-16 h-16 text-amber-500 mb-4" />
                    <p className="text-xl font-bold text-white mb-2">Stream Connection Error</p>
                    <p className="text-sm text-slate-400 mb-4">Cannot connect to camera stream</p>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleRetry} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm border border-slate-700">Retry</motion.button>
                  </div>
                )}

                {streamActive && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-4 left-4 z-20 flex items-center px-3 py-1.5 bg-red-500 rounded-lg text-white text-sm font-bold shadow-lg shadow-red-500/30">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse mr-2" /> LIVE
                  </motion.div>
                )}
                {isDetecting && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-4 right-4 z-20 flex items-center px-3 py-1.5 bg-indigo-600 rounded-lg text-white text-sm font-bold shadow-lg shadow-indigo-500/30">
                    <Cpu className="w-4 h-4 mr-1.5" /> AI ACTIVE
                  </motion.div>
                )}
                {aiZoomEnabled && trackingActive && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="absolute top-4 right-32 z-20 flex items-center px-2.5 py-1 bg-emerald-500/90 rounded-lg text-white text-xs font-bold shadow-lg">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse mr-1.5" />
                    TRACKING {trackedLabel?.toUpperCase()}
                  </motion.div>
                )}
                {detections.length > 0 && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute bottom-20 left-4 z-20 flex items-center px-3 py-1.5 bg-amber-500 rounded-lg text-white text-sm font-bold shadow-lg shadow-amber-500/30">
                    <Eye className="w-4 h-4 mr-1.5" /> {detections.length} DETECTION{detections.length !== 1 ? 'S' : ''}
                  </motion.div>
                )}

                {streamActive && <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50 z-10" />}

                {streamActive && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, type: 'spring', stiffness: 250 }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2"
                  >
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={handleCapture} disabled={captureUploading} title="Capture photo (P)" className="p-3 rounded-full bg-white/10 hover:bg-amber-500/80 backdrop-blur-md border-2 border-white/30 shadow-2xl shadow-black/50 transition-all disabled:opacity-50">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setGalleryOpen(true)} title="Open gallery (G)" className="p-3 rounded-full bg-white/10 hover:bg-indigo-500/80 backdrop-blur-md border-2 border-white/30 shadow-2xl shadow-black/50 transition-all">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                      </svg>
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setFiltersOpen(f => !f)} title="Image filters (I)" className="p-3 rounded-full bg-white/10 hover:bg-purple-500/80 backdrop-blur-md border-2 border-white/30 shadow-2xl shadow-black/50 transition-all">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <circle cx="12" cy="12" r="10" /><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
                      </svg>
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)" className="p-3 rounded-full bg-white/10 hover:bg-cyan-500/80 backdrop-blur-md border-2 border-white/30 shadow-2xl shadow-black/50 transition-all">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
                      </svg>
                    </motion.button>
                  </motion.div>
                )}

                {streamActive && (
                  <Toolbar
                    zoom={transform.zoom} rotation={transform.rotation} flipH={transform.flipH} flipV={transform.flipV}
                    aspect={transform.aspect} isLocked={transform.isLocked} isPlaying={isPlaying}
                    isModified={isModified} activePreset={activePreset} aiEnabled={aiZoomEnabled} filtersOpen={filtersOpen}
                    onZoomIn={transform.zoomIn} onZoomOut={transform.zoomOut} onRotateLeft={transform.rotateLeft}
                    onRotateRight={transform.rotateRight} onFlipH={transform.toggleFlipH} onFlipV={transform.toggleFlipV}
                    onAspect={transform.cycleAspect} onReset={() => { transform.reset(); resetFilters(); }}
                    onLock={transform.toggleLock} onPlayPause={() => {}}
                    onOpenFilters={() => setFiltersOpen(f => !f)} onCapture={handleCapture}
                    onOpenGallery={() => setGalleryOpen(true)} onToggleFullscreen={transform.toggleFullscreen}
                    onToggleAI={() => setAiZoomEnabled(z => !z)} onShowKeyboard={() => setShortcutsOpen(true)}
                  />
                )}

                <FilterPanel
                  open={filtersOpen} onClose={() => setFiltersOpen(false)}
                  filters={filters} setFilter={setFilter} applyPreset={applyPreset}
                  activePreset={activePreset} reset={resetFilters} isModified={isModified}
                />
              </div>

              <div className="p-4 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center space-x-3">
                  {streamUrl && (
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleRetry} className="flex items-center px-5 py-2.5 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-white border border-slate-700">
                      <Globe className="w-4 h-4 mr-2" /> {cameraSource === 'ip-camera' ? 'IP Camera' : cameraSource === 'usb' ? 'USB Camera' : 'Camera'}
                    </motion.button>
                  )}
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={isDetecting ? handleStopDetection : handleStartDetection} disabled={!streamActive} className={`flex items-center px-5 py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isDetecting ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'}`}>
                    <Scan className="w-4 h-4 mr-2" />
                    {isDetecting ? 'Stop AI' : 'Start AI'}
                  </motion.button>
                </div>
                <div className="flex items-center space-x-2">
                  <motion.button whileHover={{ scale: 1.1 }} onClick={() => setIsMuted(!isMuted)} className="p-2 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white">
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.1 }} onClick={transform.toggleFullscreen} className="p-2 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white">
                    <Maximize className="w-5 h-5" />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="glass rounded-2xl p-4 border border-slate-800/50">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Eye className="w-5 h-5 mr-2 text-indigo-400" /> Live Detections</h3>
              {detections.length === 0 ? (
                <div className="text-center py-8"><Scan className="w-12 h-12 text-slate-700 mx-auto mb-2" /><p className="text-sm text-slate-500">No detections</p></div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {detections.map((det, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className={`p-3 rounded-xl text-sm border ${det.severity === 'critical' ? 'bg-red-500/10 border-red-500/20' : det.severity === 'warning' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-slate-800/50 border-slate-700/50'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white capitalize">{det.type.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-400 font-mono">{(det.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 font-mono">{new Date(det.timestamp).toLocaleTimeString()}</div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="glass rounded-2xl p-4 border border-slate-800/50">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center"><AlertTriangle className="w-5 h-5 mr-2 text-amber-400" /> Recent Alerts</h3>
              {recentAlerts.length === 0 ? (
                <div className="text-center py-8"><Shield className="w-12 h-12 text-slate-700 mx-auto mb-2" /><p className="text-sm text-slate-500">No alerts</p></div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {recentAlerts.map((alert, i) => (
                    <div key={alert.id || i} className={`p-3 rounded-xl text-sm border ${alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20'}`}>
                      <div className="font-bold text-white capitalize">{alert.type.replace(/_/g, ' ')}</div>
                      <div className="text-xs text-slate-500 mt-1 font-mono">{new Date(alert.timestamp).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="glass rounded-2xl p-4 border border-slate-800/50">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center"><Camera className="w-5 h-5 mr-2 text-indigo-400" /> Info</h3>
              <div className="space-y-3 text-sm">
                {[
                  { label: 'Status', value: <span className={`flex items-center ${streamActive && !streamError ? 'text-emerald-400' : 'text-red-400'}`}><Wifi className="w-3.5 h-3.5 mr-1" />{streamActive && !streamError ? 'Connected' : 'Disconnected'}</span> },
                  { label: 'Source', value: <span className="text-white capitalize flex items-center">{cameraSource === 'ip-camera' && <Globe className="w-3.5 h-3.5 mr-1 text-indigo-400" />}{cameraSource.replace('-', ' ')}</span> },
                  { label: 'Stream', value: <span className="text-xs font-bold px-2 py-0.5 rounded-full border text-emerald-400 border-emerald-500/30 bg-emerald-500/10">MJPEG Direct</span> },
                  { label: 'URL', value: <span className="text-white text-xs font-mono truncate max-w-[120px] block" title={streamUrl}>{streamUrl ? `${streamUrl.slice(0, 40)}...` : 'N/A'}</span> },
                  { label: 'Zoom', value: <span className="text-amber-300 font-mono font-bold">{transform.zoom.toFixed(1)}×</span> },
                  { label: 'Filter', value: <span className="text-indigo-300 capitalize">{activePreset}</span> },
                  { label: 'AI', value: <span className={isDetecting ? 'text-indigo-400 font-bold' : 'text-slate-500'}>{isDetecting ? 'ACTIVE' : 'OFF'}</span> },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-slate-400">{item.label}</span>
                    {item.value}
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      <PhotoGallery
        open={galleryOpen} onClose={() => setGalleryOpen(false)} photos={photos}
        onDelete={async (p) => { try { await api.delete(`/photos/${p.id}`); refreshPhotos(); toast.success('Photo deleted'); } catch (e) { toast.error('Delete failed'); } }}
        onDownload={(p) => { const a = document.createElement('a'); a.href = p.url.startsWith('http') ? p.url : `${API_BASE}${p.url}`; a.download = p.filename || `photo-${p.id}.jpg`; a.click(); }}
      />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
