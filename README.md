# cc-hooks

A universal, stable, and user-friendly hook management system for Claude Code.

## Installation

```bash
npm install -g cc-hooks
```

## Quick Start

```bash
# Initialize cc-hooks in your project
cc-hooks init

# Install a hook from official templates
cc-hooks install typescript-lint

# Show all configured hooks
cc-hooks show

# Run cc-hooks (called by Claude Code automatically)
cc-hooks run
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode for development
npm run dev

# Run with debug output
node dist/cli.js --debug
```

## Architecture

- **Two-tier hook system**: Text (exit code mapping) and Structured (JSON output)
- **Resource limits**: 30s timeout, 1MB output per hook
- **Priority-based execution**: Lower priority numbers execute first
- **Platform support**: Mac/Linux native, Windows via WSL2

## Requirements

- Node.js 18.x, 20.x, or 22.x
- WSL2 for Windows users (native support planned for v0.2.0)