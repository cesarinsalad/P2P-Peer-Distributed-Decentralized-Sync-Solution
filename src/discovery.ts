import mdns from 'multicast-dns';
import os from 'os';

const mdnsServer = mdns();
const SERVICE_NAME = 'p2p-sync-mvp.local';

export function startDiscovery(port: number, onPeerDiscovered: (ip: string, peerPort: number) => void) {
  const localIp = getLocalIp();

  // Respond to queries for our service
  mdnsServer.on('query', (query) => {
    if (query.questions.some(q => q.name === SERVICE_NAME)) {
      mdnsServer.respond({
        answers: [{
          name: SERVICE_NAME,
          type: 'A',
          ttl: 300,
          data: localIp
        }, {
          name: SERVICE_NAME,
          type: 'SRV',
          ttl: 300,
          data: {
            port: port,
            target: localIp
          }
        }]
      });
    }
  });

  // Listen for responses from other peers
  const discoveredPeers = new Set<string>();

  mdnsServer.on('response', (response) => {
    const aRecord = response.answers.find(a => a.name === SERVICE_NAME && a.type === 'A');
    const srvRecord = response.answers.find(a => a.name === SERVICE_NAME && a.type === 'SRV');
    
    if (aRecord && srvRecord) {
      const ip = (aRecord as any).data as string;
      const peerPort = (srvRecord as any).data.port as number;
      const peerId = `${ip}:${peerPort}`;

      // Avoid discovering ourselves and avoid duplicate discovery events
      if ((ip !== localIp || peerPort !== port) && !discoveredPeers.has(peerId)) {
        discoveredPeers.add(peerId);
        onPeerDiscovered(ip, peerPort);
      }
    }
  });

  // Periodically query for peers
  setInterval(() => {
    mdnsServer.query({
      questions: [{
        name: SERVICE_NAME,
        type: 'A'
      }]
    });
  }, 5000);

  // Initial query
  mdnsServer.query({
    questions: [{
      name: SERVICE_NAME,
      type: 'A'
    }]
  });

  console.log(`[Discovery] mDNS discovery started on ${localIp}:${port}. Listening for peers...`);
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}
