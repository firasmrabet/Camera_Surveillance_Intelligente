/**
 * TestHarness — Self-contained WebCodecs pipeline validator
 *
 * Generates a moving JPEG in a <canvas>, feeds it through WebCodecsPlayer,
 * and plays the H.264 result. No camera, no server needed.
 *
 * Tests the full pipeline:
 *   canvas → ImageBitmap → VideoFrame → VideoEncoder → mp4-muxer → MSE → <video>
 */
import React, { useEffect, useRef, useState } from 'react';
import { WebCodecsPlayer } from './WebCodecsPlayer';
import { Check, X, Loader2, Play, Square, Activity, Cpu, Zap, AlertCircle } from 'lucide-react';

const TEST_WIDTH = 1280;
const TEST_HEIGHT = 720;

function generateMovingFrame(ctx, t) {
  // Animated gradient background
  const grad = ctx.createLinearGradient(0, 0, TEST_WIDTH, TEST_HEIGHT);
  const hue = (t / 30) % 360;
  grad.addColorStop(0, `hsl(${hue}, 70%, 20%)`);
  grad.addColorStop(1, `hsl(${(hue + 90) % 360}, 70%, 40%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEST_WIDTH, TEST_HEIGHT);

  // Bouncing ball
  const x = TEST_WIDTH / 2 + Math.cos(t / 500) * 400;
  const y = TEST_HEIGHT / 2 + Math.sin(t / 300) * 200;
  const r = 60 + Math.sin(t / 200) * 20;
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 80%, 60%)`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Frame info text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WebCodecs Test', TEST_WIDTH / 2, 80);
  ctx.font = 'bold 32px monospace';
  ctx.fillText(new Date().toLocaleTimeString(), TEST_WIDTH / 2, 140);
  ctx.font = '24px monospace';
  ctx.fillText(`Frame: ${Math.floor(t / 33)}`, TEST_WIDTH / 2, TEST_HEIGHT - 40);
}

function CodecDiagnostics() {
  const [results, setResults] = React.useState(null);
  const [running, setRunning] = React.useState(true);

  React.useEffect(() => {
    const codecs = [
      { name: 'H.264 Baseline 3.1', codec: 'avc1.42001F', muxer: 'avc' },
      { name: 'H.264 Baseline 3.1 (alt)', codec: 'avc1.42E01F', muxer: 'avc' },
      { name: 'H.264 Main 3.0', codec: 'avc1.4D401E', muxer: 'avc' },
      { name: 'H.264 High 4.0', codec: 'avc1.640028', muxer: 'avc' },
      { name: 'VP9', codec: 'vp09.00.10.08', muxer: 'vp9' },
      { name: 'AV1', codec: 'av01.0.04M.08', muxer: 'av1' }
    ];

    (async () => {
      const out = [];
      for (const c of codecs) {
        const mime = `video/mp4; codecs="${c.codec}"`;
        const msOk = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime);
        let encOk = false;
        let encError = '';
        try {
          if (typeof VideoEncoder !== 'undefined') {
            const cfg = {
              codec: c.codec,
              width: 1280, height: 720, bitrate: 1500000, framerate: 30,
              latencyMode: 'realtime'
            };
            if (c.muxer === 'avc') cfg.avc = { format: 'avc' };
            const r = await VideoEncoder.isConfigSupported(cfg);
            encOk = !!r.supported;
          } else {
            encError = 'VideoEncoder not available (Firefox?)';
          }
        } catch (e) {
          encError = e.message;
        }
        out.push({ ...c, msOk, encOk, encError });
      }
      setResults(out);
      setRunning(false);
    })();
  }, []);

  return (
    <details className="mb-6 bg-slate-800/40 border border-slate-700/50 rounded-xl" open>
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-300 hover:text-white">
        Codec Diagnostics (click to expand)
      </summary>
      <div className="px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-2">Codec</th>
              <th className="py-2">MediaSource</th>
              <th className="py-2">VideoEncoder</th>
            </tr>
          </thead>
          <tbody>
            {!results && (
              <tr><td colSpan={3} className="py-3 text-slate-500 text-center">
                {running ? 'Detecting codecs...' : 'No results'}
              </td></tr>
            )}
            {results && results.map((c) => (
              <tr key={c.codec} className="border-t border-slate-700/30">
                <td className="py-2 font-mono text-xs">{c.name}</td>
                <td className="py-2">{c.msOk ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}</td>
                <td className="py-2" title={c.encError}>
                  {c.encOk ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>}
                  {c.encError && <span className="text-xs text-slate-500 ml-2">({c.encError.slice(0, 30)})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

async function canvasToJpegBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });
}

export default function TestHarness() {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const runningRef = useRef(false);
  const [supported] = useState(() => WebCodecsPlayer.isSupported());
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ sourceFps: 0, encodedFps: 0, totalFrames: 0, encodeQueue: 0 });
  const [error, setError] = useState('');

  const start = async () => {
    if (!supported || runningRef.current) return;
    setError('');
    setRunning(true);
    runningRef.current = true;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const player = new WebCodecsPlayer(videoRef.current, {
      bitrate: 1_500_000,
      framerate: 30,
      onError: (e) => {
        setError(e.message);
        stop();
      }
    });

    try {
      await player.start(TEST_WIDTH, TEST_HEIGHT);
      playerRef.current = player;
    } catch (e) {
      setError(e.message);
      setRunning(false);
      runningRef.current = false;
      return;
    }

    const sourceCountRef = { n: 0, last: performance.now() };
    const encCountRef = { n: 0, last: performance.now() };

    player.onFps = (fps) => {
      encCountRef.n = fps;
    };

    const startTime = performance.now();
    const targetInterval = 1000 / 30;

    const tick = async () => {
      if (!runningRef.current) return;
      const t = performance.now() - startTime;
      generateMovingFrame(ctx, t);
      const blob = await canvasToJpegBlob(canvas);
      if (blob) {
        const ab = await blob.arrayBuffer();
        await player.addFrame(ab, Math.round(t * 1000));
        sourceCountRef.n++;
      }

      // Update source FPS
      const now = performance.now();
      if (now - sourceCountRef.last >= 1000) {
        setStats({
          sourceFps: sourceCountRef.n,
          encodedFps: encCountRef.n,
          totalFrames: Math.floor(t / 33),
          encodeQueue: player.getStats()?.encodeQueueSize || 0
        });
        sourceCountRef.n = 0;
        sourceCountRef.last = now;
      }

      const elapsed = performance.now() - t - startTime;
      const wait = Math.max(0, targetInterval - elapsed);
      setTimeout(tick, wait);
    };

    tick();
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (playerRef.current) {
        try { playerRef.current.stop(); } catch (_) {}
      }
    };
  }, []);

  if (!supported) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-8">
        <h1 className="text-3xl font-bold mb-6">WebCodecs Test Harness</h1>
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-6 flex items-start gap-3">
          <X className="w-6 h-6 text-red-400 flex-shrink-0 mt-1" />
          <div>
            <h2 className="text-xl font-bold text-red-300 mb-2">WebCodecs not supported</h2>
            <p className="text-slate-300">
              Your browser does not support WebCodecs API. Use Chrome 94+, Edge 94+, or Safari 16.4+.
            </p>
          </div>
        </div>
        <CodecDiagnostics />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">WebCodecs Pipeline Test</h1>
          <p className="text-slate-400">
            Self-contained test: Canvas → JPEG → ImageBitmap → VideoFrame → codec → fMP4 → MSE → &lt;video&gt;
          </p>
        </div>

        <CodecDiagnostics />

        {/* Test Result Banner */}
        <div className={`mb-6 p-4 rounded-xl border ${
          running && stats.encodedFps > 0
            ? 'bg-emerald-900/20 border-emerald-700/50'
            : error
              ? 'bg-red-900/20 border-red-700/50'
              : 'bg-slate-800/50 border-slate-700/50'
        }`}>
          {running && stats.encodedFps > 0 ? (
            <div className="flex items-center gap-3">
              <Check className="w-6 h-6 text-emerald-400" />
              <div>
                <h3 className="font-bold text-emerald-300">Pipeline Working</h3>
                <p className="text-sm text-slate-300">
                  H.264 encoding at {stats.encodedFps} FPS — should match TikTok/Instagram Live quality
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-400" />
              <div>
                <h3 className="font-bold text-red-300">Error</h3>
                <p className="text-sm text-slate-300">{error}</p>
              </div>
            </div>
          ) : running ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              <div>
                <h3 className="font-bold text-indigo-300">Encoding H.264…</h3>
                <p className="text-sm text-slate-300">Waiting for first encoded frame</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-slate-500" />
              <div>
                <h3 className="font-bold text-slate-300">Ready to Test</h3>
                <p className="text-sm text-slate-400">Click Start to validate the WebCodecs pipeline</p>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="mb-6 flex gap-3">
          {!running ? (
            <button
              onClick={start}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-semibold transition"
            >
              <Play className="w-5 h-5" />
              Start Test
            </button>
          ) : (
            <button
              onClick={stop}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-500 rounded-xl font-semibold transition"
            >
              <Square className="w-5 h-5" />
              Stop
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Activity className="w-4 h-4" /> Source FPS
            </div>
            <div className="text-2xl font-bold text-white">{stats.sourceFps}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Zap className="w-4 h-4" /> Encoded FPS
            </div>
            <div className="text-2xl font-bold text-emerald-400">{stats.encodedFps}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Cpu className="w-4 h-4" /> Encode Queue
            </div>
            <div className="text-2xl font-bold text-white">{stats.encodeQueue}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
              <Activity className="w-4 h-4" /> Total Frames
            </div>
            <div className="text-2xl font-bold text-white">{stats.totalFrames}</div>
          </div>
        </div>

        {/* Test Views */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Source canvas (what gets encoded) */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-slate-300 mb-3">Source (canvas, what we encode)</h3>
            <canvas
              ref={canvasRef}
              width={TEST_WIDTH}
              height={TEST_HEIGHT}
              className="w-full h-auto bg-black rounded-lg"
              style={{ aspectRatio: '16/9' }}
            />
          </div>

          {/* Output video (H.264 via MSE) */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-slate-300 mb-3">Output (H.264 via MSE, what user sees)</h3>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto bg-black rounded-lg"
              style={{ aspectRatio: '16/9' }}
            />
            {!running && (
              <div className="text-center text-slate-500 text-sm mt-3">Click Start to begin encoding</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
