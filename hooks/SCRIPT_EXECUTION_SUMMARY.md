# Script Execution Hook System - Summary

## 🎯 What It Does

Allows you to queue scripts to run automatically after Claude completes tasks by adding flags to your prompts:

```
"Fix the bug -s run-tests.sh"
```
→ Claude fixes bug → tests run automatically

## 🚀 Quick Setup

```bash
# Install the hooks
cc-hooks install hooks/script-queue-handler.json
cc-hooks install hooks/script-queue-executor.json
```

## 📝 Usage Examples

### Basic Script Execution
```
"Update the API -s test-runner.sh"
"Fix memory leak -s build-check.sh"
"Deploy to staging -s notify-complete.sh"
```

### Multiple Scripts
```
"Refactor codebase -s test-runner.sh -s build-check.sh -s git-status.sh"
```

### Advanced Features (with advanced-script-handler.json)
```
# With parameters
"Deploy -s notify.sh[Success,Deployed to prod]"

# Chained execution
"Big refactor -chain {lint.sh,test.sh,build.sh}"

# Conditional (only on success)
"Critical update -after smoke-test.sh"
```

## 📁 Script Location

Place scripts in `.claude/scripts/`:
```
project/
└── .claude/
    └── scripts/
        ├── test-runner.sh
        ├── build-check.sh
        ├── git-status.sh
        └── notify-complete.sh
```

## 🎯 Key Benefits

1. **Automation** - No manual script running after Claude finishes
2. **Workflow Integration** - Tests, builds, notifications all automatic
3. **Flexibility** - Any script, any language, any complexity
4. **Non-Intrusive** - Scripts run after, not during Claude's work
5. **Transparent** - See what will run in Claude's response

## 🔧 Included Example Scripts

- **test-runner.sh** - Runs npm test
- **build-check.sh** - Verifies build still works
- **git-status.sh** - Shows what changed
- **notify-complete.sh** - Desktop notification when done

## 💡 Pro Tips

1. Chain related scripts: `-chain {test,build,deploy}`
2. Add notifications for long tasks: `-s notify.sh[Task done!]`
3. Create project-specific scripts in `.claude/scripts/`
4. Use parameters for reusable scripts
5. Scripts timeout after 30 seconds by default

## 🎮 Real Example

```
You: "Implement user authentication system with tests -chain {test-runner.sh,build-check.sh} -s notify-complete.sh[Auth system complete!]"

Claude: [Implements the feature]

After Claude finishes:
1. test-runner.sh runs → "✅ All tests passed!"
2. build-check.sh runs → "✅ Build successful"
3. notify-complete.sh runs → 🔔 Desktop notification: "Auth system complete!"
```

Transform your Claude Code workflow into an automated development pipeline!