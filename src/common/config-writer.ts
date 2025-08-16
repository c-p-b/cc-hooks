import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { HooksConfigFile, HookDefinition } from './types';
import { FileOperationError } from './errors';

export class ConfigWriter {
  /**
   * Write a configuration file with pretty formatting.
   */
  write(filePath: string, config: HooksConfigFile): void {
    try {
      this.ensureDirectoryExists(path.dirname(filePath));
      const content = JSON.stringify(config, null, 2) + '\n';
      writeFileSync(filePath, content, 'utf-8');
    } catch (error) {
      throw new FileOperationError('write', filePath, error as Error);
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary.
   */
  ensureDirectoryExists(dirPath: string): void {
    if (!existsSync(dirPath)) {
      try {
        mkdirSync(dirPath, { recursive: true });
      } catch (error) {
        throw new FileOperationError('create', dirPath, error as Error);
      }
    }
  }

  /**
   * Add a hook to the configuration, checking for name conflicts.
   * Returns a new config object (immutable).
   */
  addHook(config: HooksConfigFile, hook: HookDefinition): HooksConfigFile {
    // Check for name conflict
    const existingHook = config.hooks.find(h => h.name === hook.name);
    if (existingHook) {
      throw new FileOperationError('write', 'config', new Error(`Hook with name '${hook.name}' already exists`));
    }

    return {
      ...config,
      hooks: [...config.hooks, hook]
    };
  }

  /**
   * Remove a hook from the configuration by name.
   * Returns a new config object (immutable).
   */
  removeHook(config: HooksConfigFile, name: string): HooksConfigFile {
    const filteredHooks = config.hooks.filter(h => h.name !== name);
    
    if (filteredHooks.length === config.hooks.length) {
      throw new FileOperationError('delete', 'config', new Error(`Hook with name '${name}' not found`));
    }

    return {
      ...config,
      hooks: filteredHooks
    };
  }

  /**
   * Update a hook in the configuration.
   * Returns a new config object (immutable).
   */
  updateHook(config: HooksConfigFile, name: string, updatedHook: HookDefinition): HooksConfigFile {
    const hookIndex = config.hooks.findIndex(h => h.name === name);
    
    if (hookIndex === -1) {
      throw new FileOperationError('write', 'config', new Error(`Hook with name '${name}' not found`));
    }

    // If renaming, check for conflicts
    if (updatedHook.name !== name) {
      const conflictingHook = config.hooks.find(h => h.name === updatedHook.name);
      if (conflictingHook) {
        throw new FileOperationError('write', 'config', new Error(`Hook with name '${updatedHook.name}' already exists`));
      }
    }

    const newHooks = [...config.hooks];
    newHooks[hookIndex] = updatedHook;

    return {
      ...config,
      hooks: newHooks
    };
  }

  /**
   * Check if a hook with the given name exists.
   */
  hookExists(config: HooksConfigFile, name: string): boolean {
    return config.hooks.some(h => h.name === name);
  }

  /**
   * Create an empty configuration with sensible defaults.
   */
  createEmptyConfig(): HooksConfigFile {
    return {
      logging: {
        level: 'errors'
      },
      hooks: []
    };
  }
}