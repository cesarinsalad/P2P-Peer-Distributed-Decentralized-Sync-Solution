import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import ignore from 'ignore';
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

  // Set up ignore filter
  const ig = ignore();
  const ignoreFilePath = path.join(process.cwd(), '.ignore');
  if (fs.existsSync(ignoreFilePath)) {
     const ignoreContent = fs.readFileSync(ignoreFilePath, 'utf-8');
     ig.add(ignoreContent);
     console.log('[System] Loaded .ignore file rules.');
  }

  const localIp = getLocalIp();
  const network = new NetworkManager(PORT, localIp);
  const transfer = new TransferManager(network, SYNC_DIR);

  transfer.setOnReceiveComplete(async (filename, expectedChecksum) => {
    const filePath = path.join(SYNC_DIR, filename);
    if (!fs.existsSync(filePath)) return;
    const actualChecksum = await calculateChecksum(filePath);
    if (actualChecksum === expectedChecksum) {
      console.log(`[Validation] SUCCESS: Checksum for ${filename} matches (${actualChecksum})`);
    } else {
      console.error(`[Validation] ERROR: Checksum mismatch for ${filename}. Expected ${expectedChecksum}, got ${actualChecksum}`);
    }
  });

  network.start();

  startDiscovery(PORT, (peerIp, peerPort) => {
    network.connectToPeer(peerIp, peerPort);
  });

  const broadcastFile = async (filepath: string) => {
     const relativePath = path.relative(SYNC_DIR, filepath);
     if (ig.ignores(relativePath) || relativePath.endsWith('.tmp') || relativePath.includes('.conflict-')) {
        return; // Ignored explicitly or implicitly (tmp/conflict files)
     }
     
     const filename = path.basename(filepath);
     if (transfer.isReceiving(filename)) return;

     if (fs.existsSync(filepath)) {
        try {
           const stat = fs.statSync(filepath);
           if (!stat.isFile()) return;

           const checksum = await calculateChecksum(filepath);
           const peers = network.getConnectedPeers();
           for (const peerId of peers) {
              await transfer.initiateSync(peerId, filepath, checksum);
           }
        } catch (err) {
           console.error(`[System] Error broadcasting file ${filename}:`, err);
        }
     }
  };

  // Watcher setup
  const watcher = chokidar.watch(SYNC_DIR, {
      ignored: (p: string) => {
          const stats = fs.existsSync(p) ? fs.statSync(p) : null;
          const rel = path.relative(SYNC_DIR, p);
          if (rel && ig.ignores(rel)) return true;
          if (path.basename(p).endsWith('.tmp')) return true;
          if (path.basename(p).includes('.conflict-')) return true;
          return false;
      },
      persistent: true,
      ignoreInitial: true
  });

  watcher.on('add', (filePath) => {
      broadcastFile(filePath);
  });
  
  watcher.on('change', (filePath) => {
      broadcastFile(filePath);
  });

  // Keep a periodic reconciliation for newly connected peers or missed events
  setInterval(async () => {
    const peers = network.getConnectedPeers();
    if (peers.length === 0) return;

    const files = fs.readdirSync(SYNC_DIR);
    for (const file of files) {
       const filePath = path.join(SYNC_DIR, file);
       broadcastFile(filePath);
    }
  }, 10000); // 10 seconds

  console.log(`[System] P2P Sync Node started on port ${PORT}.`);
  console.log(`[System] Drop files in ${SYNC_DIR} to sync with peers.`);
}

main().catch(console.error);
