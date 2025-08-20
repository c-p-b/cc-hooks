# Claude Code Hooks Collection

This directory contains 11 ready-to-use hooks for Claude Code that automate common development workflows.

## 📋 Hook Descriptions

### Code Quality & Linting

#### **typescript-lint.json**
- **Trigger:** After editing TypeScript files
- **Action:** Runs ESLint with max warnings set to 0
- **Purpose:** Ensures TypeScript code quality standards
- **Output:** Non-blocking errors with fix instructions

#### **typescript-format.json**
- **Trigger:** After editing TypeScript files  
- **Action:** Checks if code is properly formatted with Prettier
- **Purpose:** Maintains consistent code formatting
- **Output:** Blocking error if formatting issues detected

#### **python-lint.json**
- **Trigger:** After editing Python files
- **Action:** Runs flake8 and mypy for linting and type checking
- **Purpose:** Ensures Python code quality
- **Output:** Non-blocking warnings with fix suggestions

### Pattern Detection

#### **code-quality-scanner.json** ⭐ Recommended
- **Trigger:** After editing any code file
- **Action:** Scans for TODOs, mocks, compatibility patterns
- **Purpose:** Identifies technical debt and incomplete code
- **Output:** Structured JSON with categorized findings and suggestions

#### **compatibility-pattern-scanner.json**
- **Trigger:** After editing code files
- **Action:** Comprehensive scan with emoji-coded results
- **Purpose:** Detailed analysis of compatibility and placeholder patterns
- **Output:** Rich text with 🔴 TODOs, 🟡 Mocks, 🔵 Compatibility indicators

#### **pattern-scanner.json**
- **Trigger:** After editing code files
- **Action:** Quick scan of git diffs for common patterns
- **Purpose:** Lightweight pattern detection in staged changes
- **Output:** Simple text warnings

### Session Management

#### **session-context.json**
- **Trigger:** At session start
- **Action:** Shows git status and recent commits
- **Purpose:** Provides repository context to Claude
- **Output:** Current git status and last 5 commits

#### **session-init-md.json**
- **Trigger:** At session start
- **Action:** Reads and displays CLAUDE.md file
- **Purpose:** Loads project-specific instructions for Claude
- **Output:** Contents of CLAUDE.md if it exists

### User Input Processing

#### **userprompt-rewrite-ultrahink.json**
- **Trigger:** On user prompt submission
- **Action:** Substitutes `-u` with `ultrathink. Take as much time as you need.`
- **Purpose:** Encourages thorough analysis by rewriting shortcuts
- **Output:** Modified prompt with substitution

### Git Workflow

#### **git-commit-msg.json**
- **Trigger:** When Claude stops (typically before commits)
- **Action:** Suggests conventional commit message format
- **Purpose:** Maintains consistent commit message style
- **Output:** Formatted commit message suggestion

### Memory Management

#### **precompact-save-last-200-lines.json**
- **Trigger:** Before memory compaction
- **Action:** Saves last 200 lines of conversation to `.claude/last-conversation.md`
- **Purpose:** Preserves context before memory cleanup
- **Output:** Success message after saving

## 🚀 Installation

Install individual hooks:
```bash
# Install a specific hook
cc-hooks install hooks/code-quality-scanner.json

# Install multiple hooks
cc-hooks install hooks/typescript-lint.json
cc-hooks install hooks/session-context.json
```

## 🎯 Recommended Setup

For a comprehensive development setup, install these hooks:

```bash
# Core quality checks
cc-hooks install hooks/code-quality-scanner.json

# Language-specific (choose based on your stack)
cc-hooks install hooks/typescript-lint.json  # For TypeScript projects
cc-hooks install hooks/python-lint.json     # For Python projects

# Session management
cc-hooks install hooks/session-context.json

# Memory preservation
cc-hooks install hooks/precompact-save-last-200-lines.json
```

## 📊 Hook Events

| Event | Hooks | Purpose |
|-------|-------|---------|
| **PostToolUse** | typescript-lint, python-lint, pattern scanners | Code quality after edits |
| **SessionStart** | session-context, session-init-md | Initialize with context |
| **UserPromptSubmit** | userprompt-rewrite-ultrahink | Modify user input |
| **Stop** | git-commit-msg | Pre-commit actions |
| **PreCompact** | precompact-save-last-200-lines | Memory management |

## 🔧 Customization

Each hook is a JSON file that can be customized:

```json
{
  "name": "hook-name",
  "command": ["command", "args"],
  "events": ["EventName"],
  "outputFormat": "text|structured",
  "timeout": 60,
  "priority": 50
}
```

## 📝 Output Formats

- **Text hooks:** Simple string output displayed to user
- **Structured hooks:** JSON output for flow control
  - `decision`: "continue" | "block" | "stop"
  - `message`: User-facing message
  - `prompt`: Modified prompt (for UserPromptSubmit)

## 🧪 Testing

Test all hooks:
```bash
node test-hooks.js
```

Test pattern scanners specifically:
```bash
node test-pattern-scanner.js
```

## 💡 Tips

1. Start with `session-context.json` for git awareness
2. Add `code-quality-scanner.json` to catch TODOs early
3. Use language-specific linters for your tech stack
4. Enable `precompact-save-last-200-lines.json` to never lose context
5. Combine multiple hooks for comprehensive automation

## 🚫 Troubleshooting

If a hook isn't working:
1. Check it's installed: `cc-hooks show`
2. Verify dependencies (e.g., eslint, prettier, flake8)
3. Test manually: `cc-hooks run --event PostToolUse --file test.ts`
4. Check logs: `cc-hooks logs hook-name`