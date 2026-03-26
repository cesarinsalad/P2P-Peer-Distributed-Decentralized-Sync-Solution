import crypto from 'crypto';
import fs from 'fs';

export async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const readStream = fs.createReadStream(filePath);

    readStream.on('error', (err) => reject(err));
    readStream.on('data', (chunk) => hash.update(chunk));
    readStream.on('end', () => resolve(hash.digest('hex')));
  });
}
