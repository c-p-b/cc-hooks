#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Writable } = require('stream');
const parser = require('conventional-commits-parser').CommitParser;

// Get commit message from command line
const commitMsg = process.argv[2];
if (!commitMsg) {
  console.error('Usage: bump-version.js "commit message"');
  process.exit(1);
}

// Parse the commit using the same parser as the PR validation
const commitParser = new parser({});
const parsed = commitParser.parse(commitMsg);

// Check if it's a valid conventional commit
if (!parsed.type) {
  console.log('Not a conventional commit, skipping version bump');
  process.exit(0);
}

// Read current package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = pkg.version;

// Parse semantic version
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Determine version bump based on conventional commit type
let newVersion;

// Check for breaking change in footer or with ! after type
const isBreaking = parsed.notes.some(note => note.title === 'BREAKING CHANGE') || 
                   commitMsg.includes(`${parsed.type}!:`);

if (isBreaking) {
  newVersion = `${major + 1}.0.0`;
} else if (parsed.type === 'feat') {
  newVersion = `${major}.${minor + 1}.0`;
} else if (parsed.type === 'fix') {
  newVersion = `${major}.${minor}.${patch + 1}`;
} else {
  // For chore, docs, style, refactor, perf, test, build, ci, revert
  // No version bump by default - you can change this if you want
  console.log(`Commit type '${parsed.type}' doesn't trigger a release`);
  process.exit(0);
}

console.log(`Bumping version: ${currentVersion} → ${newVersion}`);

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

// Update package-lock.json
try {
  execSync('npm install --package-lock-only', { stdio: 'inherit' });
} catch (e) {
  console.error('Failed to update package-lock.json:', e.message);
}

// Update or create CHANGELOG.md
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const date = new Date().toISOString().split('T')[0];

// Determine change category
const changeType = isBreaking ? 'BREAKING CHANGES' :
                   parsed.type === 'feat' ? 'Features' :
                   parsed.type === 'fix' ? 'Bug Fixes' : 'Changes';

// Build changelog entry
const description = parsed.subject || commitMsg;
const scope = parsed.scope ? `**${parsed.scope}:** ` : '';
const newEntry = `## [${newVersion}] - ${date}

### ${changeType}
- ${scope}${description}

`;

let changelog = '';
if (fs.existsSync(changelogPath)) {
  changelog = fs.readFileSync(changelogPath, 'utf8');
}

// Ensure proper header
if (!changelog.startsWith('# Changelog')) {
  changelog = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n' + changelog;
}

// Insert new entry after the header
const headerEnd = changelog.indexOf('\n\n') + 2;
changelog = changelog.slice(0, headerEnd) + newEntry + changelog.slice(headerEnd);

fs.writeFileSync(changelogPath, changelog);

console.log(`✅ Version bumped to ${newVersion}`);
console.log(`✅ CHANGELOG.md updated`);