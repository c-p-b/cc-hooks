import { StreamLimiter } from '../../../src/orchestrator/stream-limiter';
import { Readable, Writable } from 'stream';

describe('StreamLimiter', () => {
  it('should pass through data under the limit', (done) => {
    const maxBytes = 100;
    let limitExceeded = false;
    
    const limiter = new StreamLimiter(maxBytes, () => {
      limitExceeded = true;
    }, 'test');

    const input = Buffer.from('Hello, World!');
    const output: Buffer[] = [];

    limiter.on('data', (chunk: Buffer) => {
      output.push(chunk);
    });

    limiter.on('end', () => {
      expect(limitExceeded).toBe(false);
      expect(Buffer.concat(output).toString()).toBe('Hello, World!');
      expect(limiter.getBytesRead()).toBe(13);
      expect(limiter.isLimitExceeded()).toBe(false);
      done();
    });

    limiter.write(input);
    limiter.end();
  });

  it('should trigger callback when limit is exceeded', (done) => {
    const maxBytes = 10;
    let limitExceeded = false;
    let callbackCalled = false;
    
    const limiter = new StreamLimiter(maxBytes, () => {
      callbackCalled = true;
    }, 'test');

    limiter.on('limit-exceeded', (info) => {
      limitExceeded = true;
      expect(info.label).toBe('test');
      expect(info.maxBytes).toBe(10);
      expect(info.bytesRead).toBeGreaterThan(10);
    });

    // Write more than the limit
    limiter.write(Buffer.from('This is a long string that exceeds the limit'));
    
    // Check immediately after write
    expect(limitExceeded).toBe(true);
    expect(callbackCalled).toBe(true);
    expect(limiter.isLimitExceeded()).toBe(true);
    
    limiter.end();
    done();
  });

  it('should stop processing after limit is exceeded', (done) => {
    const maxBytes = 5;
    const output: Buffer[] = [];
    
    const limiter = new StreamLimiter(maxBytes, () => {}, 'test');

    limiter.on('data', (chunk: Buffer) => {
      output.push(chunk);
    });

    limiter.on('end', () => {
      // Should only have data up to the limit
      const result = Buffer.concat(output);
      expect(result.length).toBeLessThanOrEqual(maxBytes);
      done();
    });

    // Write in chunks
    limiter.write(Buffer.from('123'));
    limiter.write(Buffer.from('456'));
    limiter.write(Buffer.from('789'));
    limiter.end();
  });

  it('should handle multiple chunks correctly', (done) => {
    const maxBytes = 20;
    let limitExceeded = false;
    const output: Buffer[] = [];
    
    const limiter = new StreamLimiter(maxBytes, () => {
      limitExceeded = true;
    }, 'test');

    limiter.on('data', (chunk: Buffer) => {
      output.push(chunk);
    });

    limiter.on('end', () => {
      expect(limitExceeded).toBe(false);
      expect(Buffer.concat(output).toString()).toBe('12345678901234567890');
      expect(limiter.getBytesRead()).toBe(20);
      done();
    });

    // Write exactly the limit in chunks
    limiter.write(Buffer.from('12345'));
    limiter.write(Buffer.from('67890'));
    limiter.write(Buffer.from('12345'));
    limiter.write(Buffer.from('67890'));
    limiter.end();
  });

  it('should work with pipe', (done) => {
    const maxBytes = 15;
    let limitExceeded = false;
    
    const limiter = new StreamLimiter(maxBytes, () => {
      limitExceeded = true;
    }, 'test');

    const input = new Readable({
      read() {
        this.push('Hello, World! This is a test.');
        this.push(null);
      }
    });

    const output: string[] = [];
    const writer = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      }
    });

    writer.on('finish', () => {
      expect(limitExceeded).toBe(true);
      expect(limiter.isLimitExceeded()).toBe(true);
      // Output should be truncated
      const result = output.join('');
      expect(result.length).toBeLessThanOrEqual(maxBytes);
      done();
    });

    input.pipe(limiter).pipe(writer);
  });
});