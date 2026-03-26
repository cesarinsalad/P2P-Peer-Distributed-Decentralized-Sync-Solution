import fs from 'fs';
import path from 'path';
import { NetworkManager } from './network';

export class TransferManager {
  private syncDir: string;
  private receivingFiles: Map<string, { writeStream: fs.WriteStream, receivedSize: number, totalSize: number, expectedChecksum: string }> = new Map();
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

  public sendFile(peerId: string, filePath: string, checksum: string) {
    const filename = path.basename(filePath);
    const stat = fs.statSync(filePath);
    const totalSize = stat.size;

    console.log(`[Transfer] Initiating transfer of ${filename} to ${peerId} (Size: ${totalSize} bytes)`);

    // Send metadata header
    const header = {
      type: 'START',
      filename,
      totalSize,
      checksum
    };
    this.network.send(peerId, Buffer.from(JSON.stringify(header)));

    // Send chunks to avoid large memory allocations
    const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks
    readStream.on('data', (chunk: Buffer) => {
      const chunkMsg = {
        type: 'CHUNK',
        filename,
        data: chunk.toString('base64')
      };
      this.network.send(peerId, Buffer.from(JSON.stringify(chunkMsg)));
    });

    readStream.on('end', () => {
      const endMsg = {
        type: 'END',
        filename
      };
      this.network.send(peerId, Buffer.from(JSON.stringify(endMsg)));
      console.log(`[Transfer] Finished sending ${filename} to ${peerId}`);
    });
  }

  private handleData(peerId: string, data: Buffer) {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'START') {
      console.log(`[Transfer] Start receiving ${msg.filename} from ${peerId} (Expected SHA256: ${msg.checksum})`);
      const destPath = path.join(this.syncDir, msg.filename);
      const writeStream = fs.createWriteStream(destPath);
      this.receivingFiles.set(msg.filename, { 
        writeStream, 
        receivedSize: 0, 
        totalSize: msg.totalSize,
        expectedChecksum: msg.checksum
      });
    } 
    else if (msg.type === 'CHUNK') {
      const state = this.receivingFiles.get(msg.filename);
      if (state) {
        const chunkBuf = Buffer.from(msg.data, 'base64');
        state.writeStream.write(chunkBuf);
        state.receivedSize += chunkBuf.length;
      }
    } 
    else if (msg.type === 'END') {
      const state = this.receivingFiles.get(msg.filename);
      if (state) {
        state.writeStream.close();
        const checksum = state.expectedChecksum;
        this.receivingFiles.delete(msg.filename);
        console.log(`[Transfer] Completed receiving ${msg.filename} from ${peerId}`);
        // Trigger completion to run checksum validation
        this.onReceiveCompleteCallback(msg.filename, checksum);
      }
    }
  }
}
