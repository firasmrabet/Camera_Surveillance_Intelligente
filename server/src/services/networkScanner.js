/**
 * Network scanner: discover IP cameras on the local network by probing
 * a target port across a /24 subnet (or smaller range).
 *
 * Used by the Add Camera wizard to help users find their phone's IP.
 */
const net = require('net');
const os = require('os');
const dgram = require('dgram');

const PROBE_TIMEOUT_MS = 800;
const PARALLEL_PROBES = 64;

function getLocalSubnets() {
  const ifaces = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        if (parts.length === 4) {
          subnets.push({
            interface: name,
            baseIp: `${parts[0]}.${parts[1]}.${parts[2]}`,
            address: iface.address,
            netmask: iface.netmask
          });
        }
      }
    }
  }
  return subnets;
}

function probeTcp(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise(resolve => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open ? { host, port, responseTime: Date.now() - start, open: true } : null);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function scanSubnet(baseIp, port, options = {}) {
  const { start = 1, end = 254, parallel = PARALLEL_PROBES } = options;
  const queue = [];
  for (let i = start; i <= end; i++) queue.push(`${baseIp}.${i}`);

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const idx = cursor++;
      const host = queue[idx];
      const res = await probeTcp(host, port);
      if (res) results.push(res);
    }
  }

  const workers = Array.from({ length: Math.min(parallel, queue.length) }, () => worker());
  await Promise.all(workers);
  return results.sort((a, b) => a.host.localeCompare(b.host));
}

async function scanNetwork({ port = 8080, subnetBase = null, start = 1, end = 254 } = {}) {
  const subnets = getLocalSubnets();
  if (!subnets.length) {
    return { ok: false, error: 'No active network interfaces found', subnets: [], devices: [] };
  }
  const baseIp = subnetBase || subnets[0].baseIp;
  const devices = await scanSubnet(baseIp, port, { start, end });
  return {
    ok: true,
    subnets: subnets.map(s => ({ interface: s.interface, address: s.address, baseIp: s.baseIp })),
    scannedBase: baseIp,
    port,
    devices
  };
}

/**
 * Optional: send a UDP probe to a known IP Webcam discovery port (5353 mDNS).
 * Most IP Webcam installs don't advertise mDNS, but we try anyway.
 */
function mdnsBrowse(serviceType, timeoutMs = 2000) {
  return new Promise(resolve => {
    const client = dgram.createSocket('udp4');
    const entries = [];
    let timer;

    client.on('message', (msg, rinfo) => {
      // very loose parser: just record the responder
      entries.push({ from: rinfo.address, port: rinfo.port, size: msg.length });
    });

    client.on('error', () => { /* swallow */ });
    client.bind(0, () => {
      try {
        // Browser/multicast DNS query for "_http._tcp.local"
        const query = Buffer.from([
          0x00, 0x00, // ID
          0x01, 0x00, // flags: standard query, recursion desired
          0x00, 0x01, // QDCOUNT
          0x00, 0x00, // ANCOUNT
          0x00, 0x00, // NSCOUNT
          0x00, 0x00, // ARCOUNT
          // QNAME
          ...encodeDnsName(serviceType || '_http._tcp.local'),
          0x00, 0x0c, // QTYPE: PTR
          0x00, 0x01  // QCLASS: IN
        ]);
        client.send(query, 0, 5353, '224.0.0.251');
      } catch (e) { /* ignore */ }
    });

    timer = setTimeout(() => {
      try { client.close(); } catch (e) { /* ignore */ }
      resolve(entries);
    }, timeoutMs);
  });
}

function encodeDnsName(name) {
  const out = [];
  for (const part of name.split('.')) {
    out.push(part.length);
    for (let i = 0; i < part.length; i++) out.push(part.charCodeAt(i));
  }
  return out;
}

module.exports = { scanNetwork, scanSubnet, getLocalSubnets, mdnsBrowse };
