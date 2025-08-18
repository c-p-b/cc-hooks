/**
 * Test helper for mocking process.exit in a way that distinguishes
 * between expected exits and real errors.
 */

export class ProcessExitMockError extends Error {
  constructor(public readonly exitCode: number) {
    super(`process.exit(${exitCode})`);
    this.name = 'ProcessExitMockError';
    // Ensure instanceof works correctly
    Object.setPrototypeOf(this, ProcessExitMockError.prototype);
  }
}

export interface ProcessExitMock {
  mock: jest.SpyInstance;
  expectExit(expectedCode: number): void;
  expectNotCalled(): void;
  restore(): void;
}

/**
 * Creates a process.exit mock that throws a specific error we can catch
 * without hiding real errors.
 */
export function mockProcessExit(): ProcessExitMock {
  const mock = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    const exitCode = typeof code === 'number' ? code : 0;
    throw new ProcessExitMockError(exitCode);
  }) as any;

  return {
    mock,
    expectExit(expectedCode: number) {
      expect(mock).toHaveBeenCalledWith(expectedCode);
    },
    expectNotCalled() {
      expect(mock).not.toHaveBeenCalled();
    },
    restore() {
      mock.mockRestore();
    }
  };
}

/**
 * Executes a function that's expected to call process.exit,
 * and returns the exit code. Re-throws any non-exit errors.
 */
export async function expectProcessExit(
  fn: () => Promise<void> | void
): Promise<number> {
  try {
    await fn();
    throw new Error('Expected process.exit to be called, but it was not');
  } catch (error) {
    if (error instanceof ProcessExitMockError) {
      return error.exitCode;
    }
    // Re-throw real errors
    throw error;
  }
}

/**
 * Executes a function and ensures it doesn't throw any real errors.
 * Captures process.exit if called.
 */
export async function executeWithExitCapture(
  fn: () => Promise<void> | void
): Promise<{ exited: boolean; exitCode?: number; error?: Error }> {
  try {
    await fn();
    return { exited: false };
  } catch (error) {
    if (error instanceof ProcessExitMockError) {
      return { exited: true, exitCode: error.exitCode };
    }
    // Real error - this is bad!
    return { exited: false, error: error as Error };
  }
}