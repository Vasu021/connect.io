#!/usr/bin/env node
// Runs the server and client dev processes side by side with prefixed output.
// Deliberately dependency-free: the usual helper (concurrently) pulls in
// shell-quote, which carries open RCE/DoS advisories.
import { spawn } from 'node:child_process';

const ESC = String.fromCharCode(27);
const CYAN = `${ESC}[36m`;
const MAGENTA = `${ESC}[35m`;
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;

const targets = [
  { name: 'server', color: CYAN, workspace: 'server' },
  { name: 'client', color: MAGENTA, workspace: 'client' },
];

const children = [];
let shuttingDown = false;

function prefix(target, chunk) {
  const lines = chunk.toString().split('\n');
  // Drop a single trailing empty element so we do not emit a bare prefix.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines
    .map((line) => `${target.color}${target.name.padEnd(6)}${RESET} ${DIM}|${RESET} ${line}`)
    .join('\n');
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300);
}

for (const target of targets) {
  const child = spawn('npm', ['run', 'dev', '--workspace', target.workspace], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  child.stdout.on('data', (c) => console.log(prefix(target, c)));
  child.stderr.on('data', (c) => console.error(prefix(target, c)));

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`${target.color}${target.name}${RESET} exited (${signal ?? code}) — stopping all.`);
    shutdown(typeof code === 'number' ? code : 1);
  });

  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`
  connect.io dev
  ${DIM}server${RESET} http://localhost:4000
  ${DIM}client${RESET} http://localhost:5173
`);
