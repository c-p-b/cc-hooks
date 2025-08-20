#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { CommitParser } from 'conventional-commits-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get commit message from command line
const commitMsg = process.argv[2];
if (!commitMsg) {
  console.error('Usage: bump-version.mjs "commit message"');
  process.exit(1);
}

// Parse the commit using the same parser as the PR validation
const parser = new CommitParser({});
const parsed = parser.parse(commitMsg);

// Check if it's a valid conventional commit
if (!parsed.type) {
  console.log('Not a conventional commit, skipping version bump');
  process.exit(0);
}

// Only certain types trigger releases
const releaseTriggers = ['feat', 'fix'];
const isBreaking =
  parsed.notes.some((note) => note.title === 'BREAKING CHANGE') ||
  commitMsg.includes(`${parsed.type}!:`);
const shouldRelease = releaseTriggers.includes(parsed.type) || isBreaking;

if (!shouldRelease) {
  console.log(`Commit type '${parsed.type}' doesn't trigger a release`);
  process.exit(0);
}

// Read current package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = pkg.version;

// Parse semantic version
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Determine version bump
let newVersion;
if (isBreaking) {
  newVersion = `${major + 1}.0.0`;
} else if (parsed.type === 'feat') {
  newVersion = `${major}.${minor + 1}.0`;
} else if (parsed.type === 'fix') {
  newVersion = `${major}.${minor}.${patch + 1}`;
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
const changeType = isBreaking
  ? 'BREAKING CHANGES'
  : parsed.type === 'feat'
    ? 'Features'
    : parsed.type === 'fix'
      ? 'Bug Fixes'
      : 'Changes';

// Build changelog entry
const scope = parsed.scope ? `**${parsed.scope}:** ` : '';
const description = parsed.subject || parsed.header || commitMsg;
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
  changelog =
    '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n' +
    changelog;
}

// Insert new entry after the header
const headerEnd = changelog.indexOf('\n\n') + 2;
changelog = changelog.slice(0, headerEnd) + newEntry + changelog.slice(headerEnd);

fs.writeFileSync(changelogPath, changelog);

console.log(`✅ Version bumped to ${newVersion}`);
console.log(`✅ CHANGELOG.md updated`);
