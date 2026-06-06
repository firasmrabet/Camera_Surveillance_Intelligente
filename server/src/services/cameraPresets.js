/**
 * Camera connection presets for major brands
 * Each preset provides default paths/ports and connection heuristics
 */
const PRESETS = [
  {
    id: 'hikvision',
    vendor: 'Hikvision',
    protocols: ['rtsp', 'onvif', 'hls'],
    defaultPaths: [
      '/Streaming/Channels/101',
      '/Streaming/Channels/102',
      '/Streaming/Channels/201',
      '/Streaming/Channels/1',
      '/h264/ch01/main/av_stream',
      '/cam/realmonitor?channel=1&subtype=0'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    defaultAuth: { username: 'admin', password: '12345' },
    snapshotPath: '/ISAPI/Streaming/channels/1/picture',
    supportsOnvif: true,
    notes: 'Try channel 101 (HD) or 102 (SD) for main/sub stream'
  },
  {
    id: 'dahua',
    vendor: 'Dahua',
    protocols: ['rtsp', 'onvif', 'hls'],
    defaultPaths: [
      '/cam/realmonitor?channel=1&subtype=0',
      '/cam/realmonitor?channel=1&subtype=1',
      '/live.sdp',
      '/h264/ch01/main/av_stream',
      '/Streaming/Channels/1'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    defaultAuth: { username: 'admin', password: 'admin' },
    snapshotPath: '/cgi-bin/snapshot.cgi',
    supportsOnvif: true
  },
  {
    id: 'axis',
    vendor: 'Axis',
    protocols: ['rtsp', 'onvif', 'hls'],
    defaultPaths: [
      '/axis-media/media.amp',
      '/axis-media/media.amp?videocodec=h264',
      '/onvif/Streaming/channels/1'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    defaultAuth: { username: 'root', password: 'pass' },
    snapshotPath: '/axis-cgi/jpg/image.cgi',
    supportsOnvif: true
  },
  {
    id: 'reolink',
    vendor: 'Reolink',
    protocols: ['rtsp', 'onvif'],
    defaultPaths: ['/h264Preview_01_main', '/h264Preview_01_sub', '/Streaming/Channels/101'],
    defaultPort: { rtsp: 554, onvif: 80 },
    defaultAuth: { username: 'admin', password: '' },
    supportsOnvif: true
  },
  {
    id: 'uniview',
    vendor: 'Uniview (UNV)',
    protocols: ['rtsp', 'onvif'],
    defaultPaths: [
      '/media/video1',
      '/media/video2',
      '/Streaming/Channels/101',
      '/Streaming/Channels/1'
    ],
    defaultPort: { rtsp: 554, onvif: 80 },
    supportsOnvif: true
  },
  {
    id: 'bosch',
    vendor: 'Bosch',
    protocols: ['rtsp', 'onvif'],
    defaultPaths: ['/rtsp-tunnel', '/Streaming/Channels/1'],
    defaultPort: { rtsp: 554, onvif: 80 },
    supportsOnvif: true
  },
  {
    id: 'vivotek',
    vendor: 'Vivotek',
    protocols: ['rtsp', 'onvif'],
    defaultPaths: ['/live.sdp', '/media/video1', '/Streaming/Channels/1'],
    defaultPort: { rtsp: 554, onvif: 80 },
    supportsOnvif: true
  },
  {
    id: 'foscam',
    vendor: 'Foscam',
    protocols: ['rtsp', 'mjpeg'],
    defaultPaths: ['/videoMain', '/videoSub', '/livestream/11', '/livestream/12'],
    defaultPort: { rtsp: 554, http: 80 },
    snapshotPath: '/cgi-bin/CGIProxy.fcgi?cmd=snapPicture2'
  },
  {
    id: 'tplink',
    vendor: 'TP-Link / Tapo',
    protocols: ['rtsp', 'cloud'],
    defaultPaths: ['/stream1', '/stream2', '/live/channels/1'],
    defaultPort: { rtsp: 554, http: 80 },
    notes: 'RTSP must be enabled in Tapo app first'
  },
  {
    id: 'ezviz',
    vendor: 'EZVIZ',
    protocols: ['cloud', 'rtsp'],
    defaultPaths: ['/Streaming/Channels/101'],
    defaultPort: { rtsp: 554 },
    notes: 'Cloud API requires EZVIZ Open Platform credentials'
  },
  {
    id: 'ip_webcam_android',
    vendor: 'IP Webcam (Android)',
    protocols: ['mjpeg', 'hls', 'rtsp'],
    defaultPaths: ['/?action=stream', '/videofeed', '/shot.jpg', '/video', '/mjpegfeed'],
    defaultPort: { mjpeg: 8080, hls: 8080, http: 8080, rtsp: 8554 },
    snapshotPath: '/shot.jpg',
    notes: 'IP Webcam app on Android, by Pavel Khlebovich. Set "Enable RTSP" in the app settings to use RTSP on port 8554.'
  },
  {
    id: 'onvif_generic',
    vendor: 'Generic ONVIF',
    protocols: ['onvif', 'rtsp'],
    defaultPaths: ['/onvif/Streaming/channels/1', '/Streaming/Channels/1'],
    defaultPort: { onvif: 80, rtsp: 554 },
    supportsOnvif: true,
    notes: 'Use ONVIF discovery for RTSP URL'
  },
  {
    id: 'usb_webcam',
    vendor: 'USB Webcam (built-in laptop / USB cam)',
    protocols: ['usb'],
    defaultPaths: [''],
    defaultPort: { usb: 0 },
    notes: 'Uses the server-attached USB camera via OpenCV. Index 0 = first camera. Use 1, 2, etc. for additional cameras.'
  },
  {
    id: 'amcrest',
    vendor: 'Amcrest',
    protocols: ['rtsp', 'onvif', 'mjpeg'],
    defaultPaths: [
      '/cam/realmonitor?channel=1&subtype=0',
      '/cam/realmonitor?channel=1&subtype=1',
      '/Streaming/Channels/101',
      '/h264/ch01/main/av_stream'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    snapshotPath: '/cgi-bin/snapshot.cgi',
    supportsOnvif: true,
    notes: 'Default credentials admin/admin. Try subtype=0 (HD) or 1 (SD).'
  },
  {
    id: 'lorex',
    vendor: 'Lorex',
    protocols: ['rtsp', 'onvif', 'hls'],
    defaultPaths: [
      '/Streaming/Channels/101',
      '/Streaming/Channels/102',
      '/Streaming/Channels/201',
      '/cam/realmonitor?channel=1&subtype=0'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    snapshotPath: '/ISAPI/Streaming/channels/1/picture',
    supportsOnvif: true,
    notes: 'Lorex rebrands Hikvision/Dahua. Use the same RTSP path as Hikvision (101/102) or Dahua (realmonitor).'
  },
  {
    id: 'annke',
    vendor: 'Annke',
    protocols: ['rtsp', 'onvif', 'hls'],
    defaultPaths: [
      '/Streaming/Channels/101',
      '/Streaming/Channels/102',
      '/h264/ch01/main/av_stream',
      '/Streaming/Channels/1'
    ],
    defaultPort: { rtsp: 554, onvif: 80, http: 80 },
    snapshotPath: '/ISAPI/Streaming/channels/1/picture',
    supportsOnvif: true,
    notes: 'Annke uses Hikvision-compatible streams. Try 101 (HD) or 102 (SD).'
  },
  {
    id: 'avigilon',
    vendor: 'Avigilon',
    protocols: ['rtsp', 'onvif'],
    defaultPaths: ['/Streaming/Channels/1', '/default-primary?streamprofile=Stream1'],
    defaultPort: { rtsp: 554, onvif: 80 },
    supportsOnvif: true
  },
  {
    id: 'panasonic',
    vendor: 'Panasonic i-PRO',
    protocols: ['rtsp', 'mjpeg'],
    defaultPaths: [
      '/MediaInput/mpeg4',
      '/nphMpeg4/g726-640x480',
      '/Streaming/Channels/1'
    ],
    defaultPort: { rtsp: 554, http: 80 },
    notes: 'Older Panasonic uses /MediaInput/mpeg4; newer cameras use /Streaming/Channels/1'
  },
  {
    id: 'rtsp_generic',
    vendor: 'Generic RTSP',
    protocols: ['rtsp'],
    defaultPaths: ['/', '/live.sdp', '/stream', '/video', '/ch0_0.h264'],
    defaultPort: { rtsp: 554 }
  },
  {
    id: 'cloud_wyze',
    vendor: 'Wyze',
    protocols: ['cloud', 'rtsp'],
    defaultPaths: ['/live', '/Streaming/Channels/1'],
    defaultPort: { rtsp: 554 },
    cloudApi: 'https://api.wyzecam.com',
    notes: 'RTSP firmware required'
  },
  {
    id: 'cloud_ring',
    vendor: 'Ring',
    protocols: ['cloud'],
    cloudApi: 'https://api.ring.com',
    notes: 'OAuth flow required via Ring account'
  },
  {
    id: 'cloud_arlo',
    vendor: 'Arlo',
    protocols: ['cloud'],
    cloudApi: 'https://arlo.netgear.com',
    notes: 'OAuth flow required via Arlo account'
  },
  {
    id: 'cloud_nest',
    vendor: 'Nest / Google',
    protocols: ['cloud'],
    cloudApi: 'https://smartdevicemanagement.googleapis.com',
    notes: 'Google Device Access required ($5 one-time)'
  }
];

const CLOUD_PROVIDERS = PRESETS.filter(p => p.protocols.includes('cloud'));

function getPresetById(id) {
  return PRESETS.find(p => p.id === id);
}

function getPresetsByProtocol(protocol) {
  return PRESETS.filter(p => p.protocols.includes(protocol));
}

function buildRtspUrl(connection) {
  const { host, port, path, username, password, useTLS } = connection;
  if (!host) return null;
  const protocol = useTLS ? 'rtsps' : 'rtsp';
  const portPart = port ? `:${port}` : '';
  const authPart = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  const pathPart = path || '/';
  return `${protocol}://${authPart}${host}${portPart}${pathPart.startsWith('/') ? pathPart : '/' + pathPart}`;
}

function buildRtmpUrl(connection) {
  const { host, port, path, username, password } = connection;
  if (!host) return null;
  const portPart = port ? `:${port}` : '';
  const authPart = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  const pathPart = (path || '/').startsWith('/') ? path : '/' + (path || '');
  return `rtmp://${authPart}${host}${portPart}${pathPart}`;
}

function buildSnapshotUrl(connection) {
  const { host, port, snapshotPath, useTLS, username, password, protocol } = connection;
  if (!host) return null;
  const proto = useTLS ? 'https' : (protocol === 'rtsp' ? 'http' : 'http');
  const portPart = port ? `:${port}` : '';
  const authPart = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  return `${proto}://${authPart}${host}${portPart}${snapshotPath || '/shot.jpg'}`;
}

module.exports = {
  PRESETS,
  CLOUD_PROVIDERS,
  getPresetById,
  getPresetsByProtocol,
  buildRtspUrl,
  buildRtmpUrl,
  buildSnapshotUrl
};
