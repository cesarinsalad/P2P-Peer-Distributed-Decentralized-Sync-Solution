import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import ignore from 'ignore';
import { startDiscovery } from './discovery';
import { NetworkManager } from './network';
import { TransferManager } from './transfer';
import { calculateChecksum } from './checksum';
import os from 'os';
import { Command } from 'commander';

const program = new Command();
program
  .name('peersync')
  .description('Decentralized P2P file synchronization tool')
  .version('1.0.0')
  .option('-p, --port <number>', 'Port to initialize the node', String(Math.floor(Math.random() * 10000) + 10000))
  .option('-d, --dir <path>', 'Directory to synchronize (default: current directory)', process.cwd())
  .option('-P, --peer <host:port>', 'Manually connect to a known peer (e.g. 192.168.1.20:12345)');

program.parse(process.argv);
const options = program.opts();

const PORT = parseInt(options.port, 10);
const SYNC_DIR = path.resolve(options.dir);

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
  }

  // Set up ignore filter
  const ig = ignore();
  const ignoreFilePath = path.join(SYNC_DIR, '.ignore');
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

  if (options.peer) {
    const [ip, peerPortStr] = options.peer.split(':');
    const peerPort = parseInt(peerPortStr, 10);
    if (ip && peerPort) {
      console.log(`[System] Intentionally forcing manual connection to ${ip}:${peerPort}...`);
      network.connectToPeer(ip, peerPort);
    }
  }

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
