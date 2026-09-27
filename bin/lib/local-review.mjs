#!/usr/bin/env node
// Local Codex review before the push (bin/review): runs the Codex CLI over the branch diff against main and
// blocks on P0, P1 or P2. Ported from the Compass project's bin/review; see AGENTS.md ("Two reviews before a PR").
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const BLOCKING = new Set(['P0', 'P1', 'P2']);

export function decide(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) counts[f.severity] += 1;
  return { counts, blocking: findings.some((f) => BLOCKING.has(f.severity)) };
}

export function parseReviewOutput(text) {
  if (!text || !text.trim()) throw new Error('empty Codex answer');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Codex answer is not JSON');
  }
  if (!data || !Array.isArray(data.findings)) throw new Error('Codex answer has no findings list');
  for (const f of data.findings) {
    if (!SEVERITIES.includes(f.severity)) throw new Error(`invalid severity: ${f.severity}`);
    if (typeof f.title !== 'string' || !f.title.trim()) throw new Error('finding without a title');
  }
  return data.findings;
}

export function buildPrompt(template, { base, head }) {
  return template.replaceAll('{{DIFF}}', `git diff ${base}...${head}`).replaceAll('{{HEAD}}', head);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  return r;
}

function git(...args) {
  const r = sh('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function parseArgs(argv) {
  const opts = { base: 'origin/main', fetch: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i];
    else if (argv[i] === '--no-fetch') opts.fetch = false;
    else if (argv[i] === '--force') opts.force = true;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return opts;
}

// Every successful exit re-checks HEAD: if the branch moved after it was captured, the current commit was not reviewed.
function moved(head) {
  const now = git('rev-parse', 'HEAD');
  if (now === head) return false;
  console.error(`The branch changed during the review (reviewed ${head.slice(0, 7)}, now ${now.slice(0, 7)}). Push through bin/pr, which reviews and pushes the exact commit.`);
  return true;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = git('rev-parse', '--show-toplevel');
  process.chdir(root);
  if (opts.fetch) git('fetch', '--quiet', 'origin', 'main');

  const head = git('rev-parse', 'HEAD');
  const base = git('merge-base', opts.base, head);
  if (!git('diff', '--name-only', `${base}...${head}`)) {
    console.log('Nothing to review: the branch has no changes against the base.');
    return 0;
  }

  // One mark per reviewed and approved commit, inside .git (never committed).
  const marksDir = join(git('rev-parse', '--git-common-dir'), 'prompt-studio-local-review');
  const mark = join(marksDir, `${head}-${base}.ok`);
  if (!opts.force && existsSync(mark)) {
    if (moved(head)) return 2;
    console.log(`Commit ${head.slice(0, 7)} was already reviewed locally with no blocking finding.`);
    return 0;
  }
  // Review redone: the old approval stops counting before the new result is known.
  rmSync(mark, { force: true });

  const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'prompt-studio-review-'));
  const out = join(work, 'last-message.json');
  // Codex reads whole files: it runs in an isolated copy of the exact commit, without loose changes or untracked files.
  // The prompt and schema come from that copy too, so local edits to them cannot change the criteria of an approval.
  const tree = join(work, 'tree');
  const controls = join(tree, 'bin', 'lib');
  const codex = process.env.CODEX_BIN || 'codex';
  console.log(`Local Codex review: ${head.slice(0, 7)} against ${base.slice(0, 7)} (takes 1 to 3 minutes)...`);

  try {
    git('worktree', 'add', '--quiet', '--detach', tree, head);
    for (const f of ['review-prompt.md', 'review-schema.json']) {
      if (!existsSync(join(controls, f))) {
        console.error(`The reviewed commit has no bin/lib/${f}: update the branch with main. Nothing was approved.`);
        return 2;
      }
    }
    const prompt = buildPrompt(readFileSync(join(controls, 'review-prompt.md'), 'utf8'), { base, head });
    const r = sh(codex, [
      'exec', '--sandbox', 'read-only', '--ephemeral', '--color', 'never',
      '-c', 'model_reasoning_effort="high"',
      '--output-schema', join(controls, 'review-schema.json'),
      '-o', out, prompt,
    ], { cwd: tree, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) {
      console.error(`Codex failed (exit ${r.status}). Nothing was approved.\n${(r.stderr || '').split('\n').slice(-15).join('\n')}`);
      return 2;
    }
    const findings = parseReviewOutput(existsSync(out) ? readFileSync(out, 'utf8') : '');
    for (const f of findings) {
      console.log(`- [${f.severity}] ${f.title} (${f.path}:${f.line})\n  ${f.explanation}`);
    }
    const { counts, blocking } = decide(findings);
    console.log(`Result: P0 ${counts.P0}, P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}.`);
    if (blocking) {
      console.log('Fix the P0, P1 and P2 findings before the push. For an unfounded finding, ask Bruno; bin/pr --skip-review only with his authorization.');
      return 1;
    }
    mkdirSync(marksDir, { recursive: true });
    writeFileSync(mark, `${new Date().toISOString()}\n`);
    // New commit during the review: the reviewed commit stays approved, the current HEAD does not.
    if (moved(head)) return 2;
    console.log('No blocking findings.');
    return 0;
  } catch (e) {
    console.error(`Invalid local review: ${e.message}. Nothing was approved.`);
    return 2;
  } finally {
    sh('git', ['worktree', 'remove', '--force', tree]);
    rmSync(work, { recursive: true, force: true });
    sh('git', ['worktree', 'prune']);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`Local review stopped: ${e.message}`);
    process.exitCode = 2;
  }
}
