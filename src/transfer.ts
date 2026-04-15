import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NetworkManager } from './network';

const BLOCK_SIZE = 64 * 1024;

export class TransferManager {
  private syncDir: string;
  private receivingFiles: Map<string, {
    tmpPath: string,
    fd: number,
    expectedChecksum: string,
    remoteMtime: number
  }> = new Map();
  private onReceiveCompleteCallback: (filename: string, expectedChecksum: string) => void = () => {};

  public isReceiving(filename: string): boolean {
    return this.receivingFiles.has(filename);
  }

  constructor(private network: NetworkManager, syncDir: string) {
    this.syncDir = syncDir;
    if (!fs.existsSync(this.syncDir)) {
      fs.mkdirSync(this.syncDir, { recursive: true });
    }

    this.network.setOnData((peerId, data) => this.handleData(peerId, data));
  }

  public setOnReceiveComplete(callback: (filename: string, expectedChecksum: string) => void) {
    this.onReceiveCompleteCallback = callback;
  }

  public async initiateSync(peerId: string, filePath: string, checksum: string) {
    const filename = path.basename(filePath);
    if (!fs.existsSync(filePath)) return;

    const stat = await fs.promises.stat(filePath);

    console.log(`[Transfer] Initiating Diff-Sync of ${filename} to ${peerId} (Size: ${stat.size} bytes)`);

    const initMsg = {
      type: 'SYNC_INIT',
      filename,
      mtime: stat.mtimeMs,
      totalSize: stat.size,
      checksum
    };
    this.network.send(peerId, Buffer.from(JSON.stringify(initMsg)));
  }

  private async calculateBlockHashes(filePath: string): Promise<string[]> {
    const hashes: string[] = [];
    const buffer = Buffer.alloc(BLOCK_SIZE);
    let fd;
    try {
      fd = await fs.promises.open(filePath, 'r');
      let bytesRead;
      do {
        const result = await fd.read(buffer, 0, BLOCK_SIZE, null);
        bytesRead = result.bytesRead;
        if (bytesRead > 0) {
          const hash = crypto.createHash('sha256').update(buffer.slice(0, bytesRead)).digest('hex');
          hashes.push(hash);
        }
      } while (bytesRead === BLOCK_SIZE);
    } catch (e) {
      console.error(e);
    } finally {
      if (fd) await fd.close();
    }
    return hashes;
  }

  private async handleData(peerId: string, data: Buffer) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) { return; }

    if (msg.type === 'SYNC_INIT') {
      const destPath = path.join(this.syncDir, msg.filename);
      let blockHashes: string[] = [];
      let localMtime = 0;

      if (fs.existsSync(destPath)) {
         const stat = await fs.promises.stat(destPath);
         localMtime = stat.mtimeMs;
         
         // Skip if we already have the exact same file
         // For brevity in transfer.ts, we can compute the checksum:
         const hash = crypto.createHash('sha256');
         const fileBuffer = await fs.promises.readFile(destPath);
         const localChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
         
         if (localChecksum === msg.checksum) {
             return; // File is in sync, ignore SYNC_INIT
         }

         blockHashes = await this.calculateBlockHashes(destPath);
      }

      this.network.send(peerId, Buffer.from(JSON.stringify({
        type: 'SYNC_ACCEPT',
        filename: msg.filename,
        blockHashes,
        localMtime
      })));

      // Prepare tmp file for receiving differential chunks
      const tmpPath = destPath + '.tmp';
      if (fs.existsSync(destPath)) {
        await fs.promises.copyFile(destPath, tmpPath);
      } else {
        await fs.promises.writeFile(tmpPath, Buffer.alloc(0));
      }
      
      const fd = fs.openSync(tmpPath, 'r+'); // Need random access write

      this.receivingFiles.set(msg.filename, {
        tmpPath,
        fd,
        expectedChecksum: msg.checksum,
        remoteMtime: msg.mtime
      });
      console.log(`[Transfer] Start Diff Sync (receiving) ${msg.filename} from ${peerId} (Expected SHA256: ${msg.checksum})`);
    }
    else if (msg.type === 'SYNC_ACCEPT') {
      const filePath = path.join(this.syncDir, msg.filename);
      if (!fs.existsSync(filePath)) return;

      const blockHashes = msg.blockHashes || [];
      
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (e) { return; } // File deleted amidst transfer
      
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(BLOCK_SIZE);
      let blockIndex = 0;
      let bytesRead;
      let diffChunksSent = 0;

      try {
        do {
          const result = await fd.read(buffer, 0, BLOCK_SIZE, null);
          bytesRead = result.bytesRead;
          if (bytesRead > 0) {
             const chunkData = buffer.slice(0, bytesRead);
             const hash = crypto.createHash('sha256').update(chunkData).digest('hex');
             if (blockHashes[blockIndex] !== hash) {
                // Different or new block
                const chunkMsg = {
                  type: 'CHUNK_DIFF',
                  filename: msg.filename,
                  offset: blockIndex * BLOCK_SIZE,
                  data: chunkData.toString('base64')
                };
                this.network.send(peerId, Buffer.from(JSON.stringify(chunkMsg)));
                diffChunksSent++;
             }
          }
          blockIndex++;
        } while (bytesRead === BLOCK_SIZE);
      } finally {
        await fd.close();
      }

      const endMsg = { type: 'END_DIFF', filename: msg.filename, totalSize: stat.size };
      this.network.send(peerId, Buffer.from(JSON.stringify(endMsg)));
      console.log(`[Transfer] Finished sending Diff Sync for ${msg.filename} to ${peerId}. Sent ${diffChunksSent} changed chunks.`);
    }
    else if (msg.type === 'CHUNK_DIFF') {
      const state = this.receivingFiles.get(msg.filename);
      if (state) {
        const chunkBuf = Buffer.from(msg.data, 'base64');
        fs.writeSync(state.fd, chunkBuf, 0, chunkBuf.length, msg.offset);
      }
    }
    else if (msg.type === 'END_DIFF') {
      const state = this.receivingFiles.get(msg.filename);
      if (state) {
        fs.closeSync(state.fd);
        const destPath = path.join(this.syncDir, msg.filename);
        
        // Truncate if the new file is smaller
        if (msg.totalSize !== undefined) {
           fs.truncateSync(state.tmpPath, msg.totalSize);
        }

        let localMtime = 0;
        let conflictOccurred = false;
        
        if (fs.existsSync(destPath)) {
          const st = fs.statSync(destPath);
          localMtime = st.mtimeMs;
        }

        // Conflict Resolution LWW + File Backup
        if (fs.existsSync(destPath) && localMtime > state.remoteMtime) {
           // We are NEWER, remote is OLDER.
           const conflictName = `${msg.filename}.conflict-older-${Date.now()}`;
           fs.renameSync(state.tmpPath, path.join(this.syncDir, conflictName));
           console.log(`[Validation] CONFLICT REJECTED: Kept newer local file. Saved older remote version as ${conflictName}`);
           conflictOccurred = true;
        } else if (fs.existsSync(destPath) && localMtime < state.remoteMtime) {
           // We are OLDER, remote is NEWER. LWW implies they win. Back up ours!
           const backupName = `${msg.filename}.conflict-backup-${Date.now()}`;
           fs.renameSync(destPath, path.join(this.syncDir, backupName));
           fs.renameSync(state.tmpPath, destPath);
           console.log(`[Validation] CONFLICT OVERWRITTEN: Remote is newer. Local backed up to ${backupName}`);
        } else {
           if (fs.existsSync(destPath)) {
               fs.unlinkSync(destPath);
           }
           fs.renameSync(state.tmpPath, destPath);
        }

        const checksum = state.expectedChecksum;
        this.receivingFiles.delete(msg.filename);
        
        if (!conflictOccurred) {
           this.onReceiveCompleteCallback(msg.filename, checksum);
        }
        console.log(`[Transfer] Completed Diff Receive for ${msg.filename} from ${peerId}`);
      }
    }
  }
}
