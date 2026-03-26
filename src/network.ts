import net from 'net';

export class NetworkManager {
  private server: net.Server;
  private connections: Map<string, net.Socket> = new Map();
  private onDataCallback: (peerId: string, data: Buffer) => void = () => {};

  constructor(private port: number, private localIp: string) {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket, true);
    });
  }

  public start() {
    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[Network] TCP Server listening on ${this.port}`);
    });
  }

  public connectToPeer(ip: string, port: number) {
    const peerId = `${ip}:${port}`;
    if (this.connections.has(peerId)) return; // Already connected
    if (ip === this.localIp && port === this.port) return; // Self connection attempt

    console.log(`[Network] Connecting to peer ${peerId}...`);
    const socket = net.createConnection({ host: ip, port }, () => {
      console.log(`[Network] Connected to peer ${peerId}`);
      this.handleConnection(socket, false, peerId);
    });

    socket.on('error', (err) => {
      console.error(`[Network] Error connecting to ${peerId}:`, err.message);
    });
  }

  public setOnData(callback: (peerId: string, data: Buffer) => void) {
    this.onDataCallback = callback;
  }

  public send(peerId: string, data: Buffer) {
    const socket = this.connections.get(peerId);
    if (socket && !socket.destroyed) {
      // Small payload framing: prepend 4-byte length indicator
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(data.length, 0);
      socket.write(Buffer.concat([lengthBuffer, data]));
    }
  }

  public getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  private handleConnection(socket: net.Socket, isIncoming: boolean, knownPeerId?: string) {
    const peerIp = socket.remoteAddress;
    const peerPort = socket.remotePort;
    const peerId = knownPeerId || `${peerIp}:${peerPort}`;
    
    this.connections.set(peerId, socket);
    if (isIncoming) {
      console.log(`[Network] Accepted incoming connection from ${peerId}`);
    }

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      buffer = Buffer.concat([buffer, dataBuf]);

      // Parse framed messages
      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);
        if (buffer.length >= 4 + messageLength) {
          const payload = buffer.slice(4, 4 + messageLength);
          buffer = buffer.slice(4 + messageLength);
          this.onDataCallback(peerId, payload);
        } else {
          break; // wait for more data to complete the frame
        }
      }
    });

    socket.on('close', () => {
      console.log(`[Network] Connection with ${peerId} closed.`);
      this.connections.delete(peerId);
    });

    socket.on('error', (err) => {
      console.error(`[Network] Socket error with ${peerId}:`, err.message);
      this.connections.delete(peerId);
    });
  }
}
