/**
 * HLS Proxy service: converts RTSP/RTMP streams to HLS using ffmpeg
 * Each camera gets its own ffmpeg process; output is HLS segments served via Express
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { logger } = require('../utils/logger');
const { buildRtspUrl, buildRtmpUrl, buildSnapshotUrl } = require('./cameraPresets');

const FFMPEG_PATH = process.env.FFMPEG_PATH ||
  path.join(__dirname, '..', '..', 'bin', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
const HLS_ROOT = path.join(__dirname, '..', '..', 'public', 'hls');

if (!fs.existsSync(HLS_ROOT)) {
  fs.mkdirSync(HLS_ROOT, { recursive: true });
}

class HLSProxy {
  constructor() {
    this.activeProxies = new Map(); // cameraId -> { process, info }
  }

  getHlsPath(cameraId) {
    return path.join(HLS_ROOT, cameraId);
  }

  getHlsUrl(cameraId) {
    return `/hls/${cameraId}/index.m3u8`;
  }

  isRunning(cameraId) {
    return this.activeProxies.has(cameraId);
  }

  /**
   * Start HLS proxy for a camera
   * @param {string} cameraId
   * @param {Object} connection - { host, port, path, username, password, useTLS, protocol }
   * @returns {Object} { ok, hlsUrl, error }
   */
  start(cameraId, connection) {
    if (this.activeProxies.has(cameraId)) {
      const existing = this.activeProxies.get(cameraId);
      return { ok: true, hlsUrl: this.getHlsUrl(cameraId), pid: existing.process.pid, alreadyRunning: true };
    }

    const outDir = this.getHlsPath(cameraId);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Build input URL
    let inputUrl;
    if (connection.protocol === 'rtsp') {
      inputUrl = buildRtspUrl(connection);
    } else if (connection.protocol === 'rtmp') {
      inputUrl = buildRtmpUrl(connection);
    } else if (connection.protocol === 'http' || connection.protocol === 'mjpeg') {
      const proto = connection.useTLS ? 'https' : 'http';
      inputUrl = `${proto}://${connection.host}${connection.port ? ':' + connection.port : ''}${connection.path || '/?action=stream'}`;
    } else {
      return { ok: false, error: `Unsupported protocol for HLS proxy: ${connection.protocol}` };
    }

    if (!inputUrl) return { ok: false, error: 'Could not build input URL' };

    // ffmpeg args: -rtsp_transport tcp + low latency HLS
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', inputUrl,
      '-c:v', 'copy',         // No re-encode for speed
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',        // 2s segments (low latency)
      '-hls_list_size', '5',   // keep 5 segments in playlist
      '-hls_flags', 'delete_segments+independent_segments',
      '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
      '-y',
      path.join(outDir, 'index.m3u8')
    ];

    let proc;
    try {
      proc = spawn(FFMPEG_PATH, args, { windowsHide: true });
    } catch (e) {
      logger.error(`[HLSProxy] Failed to spawn ffmpeg for ${cameraId}:`, e.message);
      return { ok: false, error: e.message };
    }

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 5000) stderrBuf = stderrBuf.slice(-5000);
    });
    proc.on('close', (code) => {
      logger.info(`[HLSProxy] Camera ${cameraId} ffmpeg exited (code ${code})`);
      this.activeProxies.delete(cameraId);
    });
    proc.on('error', (err) => {
      logger.error(`[HLSProxy] Camera ${cameraId} ffmpeg error:`, err.message);
    });

    this.activeProxies.set(cameraId, { process: proc, connection, startedAt: Date.now() });
    logger.info(`[HLSProxy] Started ffmpeg for ${cameraId} (pid ${proc.pid}): ${inputUrl.replace(/:[^:@/]+@/, ':***@')}`);

    return { ok: true, hlsUrl: this.getHlsUrl(cameraId), pid: proc.pid };
  }

  stop(cameraId) {
    const proxy = this.activeProxies.get(cameraId);
    if (!proxy) return { ok: false, error: 'Not running' };
    try { proxy.process.kill('SIGTERM'); } catch (e) {}
    setTimeout(() => { try { proxy.process.kill('SIGKILL'); } catch (e) {} }, 3000);
    this.activeProxies.delete(cameraId);
    // Clean segments
    const outDir = this.getHlsPath(cameraId);
    if (fs.existsSync(outDir)) {
      fs.readdirSync(outDir).forEach(f => fs.unlinkSync(path.join(outDir, f)));
      fs.rmdirSync(outDir);
    }
    return { ok: true };
  }

  status(cameraId) {
    const proxy = this.activeProxies.get(cameraId);
    if (!proxy) return { running: false };
    return {
      running: true,
      pid: proxy.process.pid,
      uptime: Date.now() - proxy.startedAt,
      hlsUrl: this.getHlsUrl(cameraId)
    };
  }

  listAll() {
    const out = {};
    for (const [id, proxy] of this.activeProxies) {
      out[id] = { pid: proxy.process.pid, uptime: Date.now() - proxy.startedAt };
    }
    return out;
  }

  stopAll() {
    for (const id of this.activeProxies.keys()) {
      this.stop(id);
    }
  }
}

module.exports = new HLSProxy();
