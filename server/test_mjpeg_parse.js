// Simulate exactly what useMjpegStream hook does
const http = require('http');
const fs = require('fs');
const token = fs.readFileSync('C:\\Users\\Mrabet\\AppData\\Local\\Temp\\opencode\\token.txt', 'utf8').trim().replace(/\r?\n/g, '');

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/cameras/cam-b6d96d86/stream',
  method: 'GET',
  headers: { Authorization: 'Bearer ' + token, Accept: 'multipart/x-mixed-replace, image/jpeg, image/*' }
}, (res) => {
  const ct = res.headers['content-type'] || '';
  console.log('STATUS:', res.statusCode, 'CT:', ct);
  const boundaryMatch = ct.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) { console.log('NO BOUNDARY'); return; }
  const boundary = `--${boundaryMatch[1].trim()}`;
  const boundaryBytes = Buffer.from(boundary, 'utf8');
  const dblCrlf = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a]);
  console.log('boundary:', boundary);
  console.log('boundary len:', boundaryBytes.length);

  let buffer = Buffer.alloc(0);
  let framesFound = 0;
  const findIndex = (haystack, needle, startFrom = 0) => {
    for (let i = startFrom; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) break;
        if (j === needle.length - 1) return i;
      }
    }
    return -1;
  };

  res.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let safety = 8;
    while (safety-- > 0) {
      let bIdx = findIndex(buffer, boundaryBytes, 0);
      if (bIdx < 0) break;
      let scan = bIdx + boundaryBytes.length;
      while (scan < buffer.length && (buffer[scan] === 0x0d || buffer[scan] === 0x0a)) scan++;
      const sepIdx = findIndex(buffer, dblCrlf, scan);
      if (sepIdx < 0) break;
      const headers = buffer.slice(scan, sepIdx).toString('utf8');
      const bodyStart = sepIdx + 4;
      const lenMatch = headers.match(/content-length:\s*(\d+)/i);
      let frameEnd;
      if (lenMatch) {
        const frameLen = parseInt(lenMatch[1], 10);
        if (buffer.length < bodyStart + frameLen) break;
        frameEnd = bodyStart + frameLen;
      } else {
        const nextBIdx = findIndex(buffer, boundaryBytes, bodyStart);
        if (nextBIdx < 0) break;
        frameEnd = nextBIdx;
        while (frameEnd > bodyStart && (buffer[frameEnd - 1] === 0x0d || buffer[frameEnd - 1] === 0x0a)) frameEnd--;
      }
      const jpegBytes = buffer.slice(bodyStart, frameEnd);
      console.log('Frame #' + (++framesFound) + ': ' + jpegBytes.length + ' bytes, magic=' + jpegBytes[0]?.toString(16) + ' ' + jpegBytes[1]?.toString(16) + ' ' + jpegBytes[2]?.toString(16) + ' Content-Length=' + (lenMatch ? lenMatch[1] : 'NONE'));
      let nextStart = frameEnd;
      while (nextStart + 1 < buffer.length && buffer[nextStart] === 0x0d && buffer[nextStart + 1] === 0x0a) { nextStart += 2; break; }
      buffer = buffer.slice(nextStart);
    }
  });
  res.on('error', e => console.log('ERR', e.message));
});
req.on('error', e => console.log('REQ ERR', e.message));
req.end();
setTimeout(() => { try { req.destroy(); } catch(_){} }, 8000);
