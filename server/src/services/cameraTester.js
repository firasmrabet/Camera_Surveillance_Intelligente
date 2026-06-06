/**
 * Camera connection tester
 * Tests RTSP, RTMP, HLS, MJPEG, ONVIF, and Cloud providers
 * Returns structured diagnostics
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const net = require('net');
const { logger } = require('../utils/logger');
const { buildRtspUrl, buildSnapshotUrl, getPresetById } = require('./cameraPresets');

class CameraTester {
  /**
   * Test connection to a camera with given configuration
   * @param {Object} config - Camera config { protocol, host, port, path, username, password, useTLS, vendor, model, ... }
   * @returns {Object} { ok, details, snapshotUrl, error, diagnostics }
   */
  async testConnection(config) {
    const start = Date.now();
    const result = {
      ok: false,
      protocol: config.protocol,
      vendor: config.vendor,
      model: config.model,
      details: {},
      snapshotUrl: null,
      streamUrl: null,
      error: null,
      diagnostics: [],
      duration_ms: 0
    };

    try {
      // 1) Network reachability check
      const reach = await this._tcpProbe(config.host, config.port, 5000);
      result.details.tcpReachable = reach.ok;
      if (!reach.ok) {
        result.error = `Cannot reach ${config.host}:${config.port} (${reach.error})`;
        result.diagnostics.push({
          type: 'network',
          severity: 'error',
          message: `Hôte inaccessible: ${reach.error}. Vérifiez IP, NAT, pare-feu.`
        });
        result.duration_ms = Date.now() - start;
        return result;
      }
      result.diagnostics.push({
        type: 'network',
        severity: 'success',
        message: `Connexion TCP OK vers ${config.host}:${config.port} en ${reach.latency}ms`
      });

      // 2) Protocol-specific tests
      switch (config.protocol) {
        case 'rtsp':
          await this._testRtsp(config, result);
          break;
        case 'rtmp':
          await this._testRtmp(config, result);
          break;
        case 'hls':
        case 'http':
        case 'mjpeg':
          await this._testHttp(config, result);
          break;
        case 'onvif':
          await this._testOnvif(config, result);
          break;
        case 'cloud':
          await this._testCloud(config, result);
          break;
        case 'webrtc':
          result.diagnostics.push({ type: 'protocol', severity: 'info', message: 'WebRTC nécessite un gateway (configurer peerConnection via TURN/STUN)' });
          result.ok = true;
          break;
        default:
          result.error = `Unknown protocol: ${config.protocol}`;
      }

      // 3) Build snapshot/stream URLs for client
      if (['rtsp', 'rtmp'].includes(config.protocol)) {
        result.snapshotUrl = buildSnapshotUrl(config);
        result.streamUrl = buildRtspUrl(config);
        // For RTSP, the browser cannot play directly — recommend HLS proxy
        result.diagnostics.push({
          type: 'protocol',
          severity: 'info',
          message: 'RTSP/RTMP non lisible par navigateur. Proxy HLS/WebRTC recommandé.'
        });
      } else if (['http', 'mjpeg', 'hls'].includes(config.protocol)) {
        const baseUrl = `${config.useTLS ? 'https' : 'http'}://${config.host}${config.port ? ':' + config.port : ''}`;
        result.snapshotUrl = config.snapshotPath ? baseUrl + config.snapshotPath : baseUrl + '/shot.jpg';
        result.streamUrl = config.path ? baseUrl + config.path : baseUrl + '/?action=stream';
      }
    } catch (e) {
      result.error = e.message;
      logger.error('[CameraTester] Error:', e);
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  async _tcpProbe(host, port, timeout = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const sock = new net.Socket();
      let resolved = false;
      const finish = (ok, error) => {
        if (resolved) return;
        resolved = true;
        sock.destroy();
        resolve({ ok, error, latency: Date.now() - start });
      };
      sock.setTimeout(timeout);
      sock.once('connect', () => finish(true, null));
      sock.once('timeout', () => finish(false, 'timeout'));
      sock.once('error', (err) => finish(false, err.code || err.message));
      try {
        sock.connect(port || 80, host);
      } catch (e) {
        finish(false, e.message);
      }
    });
  }

  async _testRtsp(config, result) {
    const url = buildRtspUrl(config);
    result.streamUrl = url;
    result.diagnostics.push({
      type: 'protocol',
      severity: 'info',
      message: `URL RTSP construite: ${url.replace(/:[^:@/]+@/, ':***@')}`
    });
    // RTSP needs RTSP-specific probe. ffmpeg/ffprobe would be ideal.
    // We use an HTTP probe of the snapshot path as a fallback
    await this._probeSnapshot(config, result);
    result.ok = result.details.snapshotReachable ?? false;
  }

  async _testRtmp(config, result) {
    result.diagnostics.push({
      type: 'protocol',
      severity: 'info',
      message: 'RTMP nécessite ffmpeg/nginx-rtmp. Conversion HLS recommandée pour navigateur.'
    });
    // Just TCP probe already done
    result.ok = true;
  }

  async _testHttp(config, result) {
    // First try with the explicit protocol choice (useTLS → http or https)
    await this._probeSnapshot(config, result);
    if (!result.details.snapshotReachable) {
      // Try the OTHER protocol as fallback (HTTPS on the same port is common for IP Webcam)
      const useHttps = !config.useTLS;
      const baseUrl = `${useHttps ? 'https' : 'http'}://${config.host}${config.port ? ':' + config.port : ''}`;
      const candidates = ['/shot.jpg', '/snapshot', '/?action=snapshot', '/video', '/mjpegfeed', '/?action=stream'];
      let found = false;
      let lastAuthError = null;
      for (const path of candidates) {
        const tryUrl = baseUrl + path;
        const probe = await this._httpProbe(tryUrl, 4000, config.username, config.password);
        if (probe.ok) {
          result.details.snapshotReachable = true;
          result.snapshotUrl = tryUrl;
          result.details.actualProtocol = useHttps ? 'https' : 'http';
          result.diagnostics.push({
            type: 'snapshot',
            severity: 'success',
            message: `Snapshot trouvé via ${useHttps ? 'HTTPS' : 'HTTP'}: ${path}${useHttps ? ' (cert auto-signé accepté)' : ''}`
          });
          found = true;
          break;
        }
        if (probe.status === 401 || probe.status === 403) lastAuthError = probe.status;
      }
      if (!found) {
        // Try the requested protocol with all fallback paths too
        const baseUrl2 = `${config.useTLS ? 'https' : 'http'}://${config.host}${config.port ? ':' + config.port : ''}`;
        for (const path of candidates) {
          if (baseUrl2 + path === result.snapshotUrl) continue; // already tried
          const tryUrl = baseUrl2 + path;
          const probe = await this._httpProbe(tryUrl, 4000, config.username, config.password);
          if (probe.ok) {
            result.details.snapshotReachable = true;
            result.snapshotUrl = tryUrl;
            result.diagnostics.push({ type: 'snapshot', severity: 'success', message: `Snapshot trouvé: ${path}` });
            found = true;
            break;
          }
          if (probe.status === 401 || probe.status === 403) lastAuthError = probe.status;
        }
      }
      if (!found && lastAuthError) {
        result.diagnostics.push({
          type: 'auth',
          severity: 'warning',
          message: `Authentification requise (HTTP ${lastAuthError}). Saisissez les identifiants dans le formulaire, ou désactivez "Autorisation" dans l'app IP Webcam (Paramètres → Identifiants).`
        });
      }
    }
    result.ok = result.details.snapshotReachable ?? false;
  }

  async _testOnvif(config, result) {
    result.diagnostics.push({
      type: 'protocol',
      severity: 'info',
      message: 'ONVIF discovery nécessite WS-Discovery (multicast SOAP). Test RTSP alternativement.'
    });
    // Fallback to RTSP path testing
    const preset = getPresetById(config.vendor);
    const paths = preset?.defaultPaths || ['/Streaming/Channels/101', '/live.sdp', '/video'];
    const baseUrl = `http://${config.host}${config.port ? ':' + config.port : ''}`;
    for (const path of paths.slice(0, 3)) {
      const testUrl = baseUrl + path;
      const probe = await this._httpProbe(testUrl, 3000, config.username, config.password);
      if (probe.ok || probe.status === 401) {
        result.diagnostics.push({ type: 'onvif', severity: 'success', message: `Chemin ONVIF/RTSP accessible: ${path}` });
        result.ok = true;
        result.streamUrl = `rtsp://${config.username ? config.username + ':' + (config.password || '') + '@' : ''}${config.host}:554${path}`;
        return;
      }
    }
    result.diagnostics.push({ type: 'onvif', severity: 'warning', message: 'Aucun chemin standard accessible. Vérifiez ONVIF discovery ou credentials.' });
    result.ok = false;
  }

  async _testCloud(config, result) {
    const preset = getPresetById(config.vendor);
    if (!preset || !preset.cloudApi) {
      result.error = 'Provider cloud inconnu';
      return;
    }
    result.diagnostics.push({
      type: 'cloud',
      severity: 'info',
      message: `Provider: ${preset.vendor} — OAuth requis via ${preset.cloudApi}`
    });
    // Token-based: just check we have credentials
    if (config.apiKey || config.token) {
      result.ok = true;
      result.diagnostics.push({ type: 'cloud', severity: 'success', message: 'Credentials cloud présents' });
    } else {
      result.diagnostics.push({ type: 'cloud', severity: 'warning', message: 'API key / token requis pour ce provider' });
    }
  }

  async _probeSnapshot(config, result) {
    const url = buildSnapshotUrl(config);
    if (!url) return;
    const probe = await this._httpProbe(url, 4000, config.username, config.password);
    result.details.snapshotReachable = probe.ok;
    if (probe.ok) {
      result.snapshotUrl = url;
      result.diagnostics.push({ type: 'snapshot', severity: 'success', message: `Snapshot accessible: ${url.replace(/:[^:@/]+@/, ':***@')}` });
    } else if (probe.status === 401 || probe.status === 403) {
      result.diagnostics.push({
        type: 'auth',
        severity: 'warning',
        message: `Authentification requise (HTTP ${probe.status}). Saisissez les identifiants dans le formulaire, ou désactivez "Autorisation" dans l'app IP Webcam (Paramètres → Identifiants).`
      });
    } else {
      result.diagnostics.push({ type: 'snapshot', severity: 'warning', message: `Snapshot inaccessible (${probe.error || probe.status})` });
    }
  }

  async _httpProbe(urlStr, timeout = 4000, username = null, password = null) {
    return new Promise((resolve) => {
      let url;
      try { url = new URL(urlStr); } catch (e) {
        resolve({ ok: false, error: 'invalid_url' });
        return;
      }
      const isHttps = url.protocol === 'https:';
      const headers = { 'User-Agent': 'CameraSecurity/2.0' };
      if (username) {
        const auth = Buffer.from(`${username}:${password || ''}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }
      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers,
        timeout
      };
      // Cameras often use self-signed certs (IP Webcam Android, cheap IP cameras).
      // Accept them by default — this is a test/probe, not a sensitive connection.
      if (isHttps) {
        reqOptions.rejectUnauthorized = false;
      }
      const protocol = isHttps ? https : http;
      const req = protocol.request(reqOptions, (res) => {
        // Consume response
        res.on('data', () => {});
        res.on('end', () => {
          const ct = res.headers['content-type'] || '';
          // 401 is "reachable but auth required" — still ok for our purposes
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          resolve({
            ok,
            status: res.statusCode,
            contentType: ct,
            isHttps
          });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
      req.end();
    });
  }
}

module.exports = new CameraTester();
