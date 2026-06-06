const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../utils/logger');

const PYTHON_SCRIPT = path.join(__dirname, '..', '..', '..', 'camera_streamer.py');
const BASE_PORT = 5100;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const DEFAULT_QUALITY = 80;
const DEFAULT_FPS = parseInt(process.env.CAMERA_FPS) || 30;

class PythonStreamer {
  constructor(cameraManager) {
    this.cameraManager = cameraManager;
    this.sessions = new Map();
    this.portCounter = BASE_PORT;
    this.usedPorts = new Set();
    // Placeholder for live streamer instance (set via setLiveStreamer)
    this.liveStreamer = null;
  }

  _nextPort() {
    while (this.usedPorts.has(this.portCounter)) this.portCounter++;
    const port = this.portCounter++;
    this.usedPorts.add(port);
    return port;
  }

  _sourceFor(camera) {
    if (!camera || !camera.url) return '0';
    if (camera.url.startsWith('usb:')) return camera.url.replace('usb:', '');
    if (camera.url.startsWith('http://') || camera.url.startsWith('https://')) {
      return camera.snapshotUrl || camera.url;
    }
    return camera.url;
  }

  /**
   * Attach a live streamer instance so that detection results can be emitted.
   * This replaces the older `setLiveStreamer` method that was removed during a refactor.
   */
  setLiveStreamer(liveStreamer) {
    this.liveStreamer = liveStreamer;
  }

  start(cameraId) {
    const existing = this.sessions.get(cameraId);
    if (existing && !existing.proc.killed) return existing.streamUrl;

    const camera = this.cameraManager.getCamera(cameraId);
    if (!camera) {
      logger.warn(`[PyStream] Camera ${cameraId} not found`);
      return null;
    }

    const port = this._nextPort();
    const streamUrl = `http://127.0.0.1:${port}/videofeed`;
    const source = this._sourceFor(camera);

    const args = [
      PYTHON_SCRIPT, '--source', source, '--port', String(port),
      '--width', '640', '--height', '480',
      '--quality', '80', '--fps', String(DEFAULT_FPS)
    ];

    logger.info(`[PyStream] start ${cameraId}: ${source} -> localhost:${port}`);

    const proc = spawn('python', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    proc.stderr.on('data', (d) => {
      const m = d.toString().trim();
      if (m) logger.info(`[PyStream][${cameraId}] ${m}`);
    });

    proc.on('exit', (code) => {
      logger.info(`[PyStream] ${cameraId} exited (code=${code})`);
      this.sessions.delete(cameraId);
      this.usedPorts.delete(port);
    });
    proc.on('error', (err) => {
      logger.error(`[PyStream] ${cameraId} error: ${err.message}`);
      this.sessions.delete(cameraId);
      this.usedPorts.delete(port);
    });

    this.sessions.set(cameraId, { proc, port, streamUrl, source, startedAt: Date.now() });
    return streamUrl;
  }

  stop(cameraId) {
    const session = this.sessions.get(cameraId);
    if (!session) return;
    try { session.proc.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => { try { session.proc.kill('SIGKILL'); } catch (_) {} }, 3000);
    this.usedPorts.delete(session.port);
    this.sessions.delete(cameraId);
    logger.info(`[PyStream] stop ${cameraId}`);
  }

  getStreamUrl(cameraId) {
    const session = this.sessions.get(cameraId);
    return session ? session.streamUrl : null;
  }
}

module.exports = PythonStreamer;
