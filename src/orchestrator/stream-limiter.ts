import { Transform, TransformCallback } from 'stream';

/**
 * Transform stream that enforces byte limits on data passing through.
 * Kills the associated process when limits are exceeded.
 */
export class StreamLimiter extends Transform {
  private bytesRead = 0;
  private killed = false;

  constructor(
    private readonly maxBytes: number,
    private readonly onLimitExceeded: () => void,
    private readonly label: string = 'output'
  ) {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    if (this.killed) {
      callback();
      return;
    }

    this.bytesRead += chunk.length;

    if (this.bytesRead > this.maxBytes) {
      // Kill the process IMMEDIATELY
      this.killed = true;
      this.onLimitExceeded();
      
      // Emit event for logging/debugging
      this.emit('limit-exceeded', {
        label: this.label,
        bytesRead: this.bytesRead,
        maxBytes: this.maxBytes
      });
      
      // End the stream
      this.push(null);
      callback();
    } else {
      // Pass through the chunk
      this.push(chunk);
      callback();
    }
  }

  /**
   * Get the number of bytes read so far.
   */
  getBytesRead(): number {
    return this.bytesRead;
  }

  /**
   * Check if the limit was exceeded.
   */
  isLimitExceeded(): boolean {
    return this.killed;
  }
}