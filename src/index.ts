import fs from 'fs';
import path from 'path';
import { startDiscovery } from './discovery';
import { NetworkManager } from './network';
import { TransferManager } from './transfer';
import { calculateChecksum } from './checksum';
import os from 'os';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : Math.floor(Math.random() * 10000) + 10000;
const SYNC_DIR = path.join(process.cwd(), `sync-${PORT}`);

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function main() {
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
    // Write a dummy file to start syncing immediately
    fs.writeFileSync(path.join(SYNC_DIR, `hello-${PORT}.txt`), `Hello from node initialized on port ${PORT}!`);
  }

  const localIp = getLocalIp();
  const network = new NetworkManager(PORT, localIp);
  const transfer = new TransferManager(network, SYNC_DIR);

  const sentFiles = new Set<string>();

  transfer.setOnReceiveComplete(async (filename, expectedChecksum) => {
    const filePath = path.join(SYNC_DIR, filename);
    const actualChecksum = await calculateChecksum(filePath);
    if (actualChecksum === expectedChecksum) {
      console.log(`[Validation] SUCCESS: Checksum for ${filename} matches (${actualChecksum})`);
      // Prevent echoing the exact file we just received back to the network
      for (const peerId of network.getConnectedPeers()) {
        sentFiles.add(`${peerId}-${filename}-${actualChecksum}`);
      }
    } else {
      console.error(`[Validation] ERROR: Checksum mismatch for ${filename}. Expected ${expectedChecksum}, got ${actualChecksum}`);
    }
  });

  network.start();

  startDiscovery(PORT, (peerIp, peerPort) => {
    network.connectToPeer(peerIp, peerPort);
  });

  // sentFiles lifted above

  // Periodically check for new files to push
  setInterval(async () => {
    const peers = network.getConnectedPeers();
    if (peers.length === 0) return;

    const files = fs.readdirSync(SYNC_DIR);
    for (const file of files) {
      if (transfer.isReceiving(file)) continue; // Ignore files actively resolving chunk streams

      const filePath = path.join(SYNC_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const checksum = await calculateChecksum(filePath);
        for (const peerId of peers) {
          const syncKey = `${peerId}-${file}-${checksum}`;
          // Send file if we haven't sent this exact version to this peer before
          if (!sentFiles.has(syncKey)) {
            sentFiles.add(syncKey);
            transfer.sendFile(peerId, filePath, checksum);
          }
        }
      }
    }
  }, 5000);

  console.log(`[System] P2P Sync Node started on port ${PORT}.`);
  console.log(`[System] Drop files in ${SYNC_DIR} to sync with peers.`);
}

main().catch(console.error);
