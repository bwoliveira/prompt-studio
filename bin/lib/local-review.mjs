#!/usr/bin/env node
// Local Codex review before the push (bin/review): runs the Codex CLI over the branch diff against the repository's
// base branch and blocks on P0, P1 or P2. Ported from the Compass project's bin/review; see AGENTS.md ("Pull requests").
//
// Base branch: BASE_BRANCH, else origin's default branch, else main (`--print-base` prints it). Codex run limit:
// CODEX_TIMEOUT_SECONDS (default 900); a timeout or any failure never approves. `--summary-file <path>` writes the
// review verdict as Markdown, which bin/pr puts into the pull request body.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
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

export const DEFAULT_CODEX_TIMEOUT_SECONDS = 900;

export function codexTimeoutSeconds(env = process.env) {
  const n = Number(env.CODEX_TIMEOUT_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CODEX_TIMEOUT_SECONDS;
}

// Markdown verdict of one review; goes into the pull request body.
export function formatSummary({ head, base, findings, counts, blocking }) {
  const lines = [
    '## Local Codex review',
    '',
    `Commit \`${head.slice(0, 7)}\` against \`${base.slice(0, 7)}\`: ${blocking ? '**blocked** (P0, P1 or P2 found)' : '**approved** (no P0, P1 or P2)'}.`,
    `Result: P0 ${counts.P0}, P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}.`,
  ];
  if (findings.length) lines.push('');
  for (const f of findings) lines.push(`- [${f.severity}] ${f.title} (${f.path}:${f.line}): ${f.explanation}`);
  return `${lines.join('\n')}\n`;
}

export const REVIEW_START = '<!-- local-review:start -->';
export const REVIEW_END = '<!-- local-review:end -->';

// Puts the review summary between the markers of a pull request body: replaces the section when the markers are
// there, appends it otherwise. Text written by hand outside the markers is never touched.
export function withReviewSection(body, summary) {
  const section = `${REVIEW_START}\n${summary.replace(/\n+$/, '')}\n${REVIEW_END}\n`;
  const start = body.indexOf(REVIEW_START);
  const end = start < 0 ? -1 : body.indexOf(REVIEW_END, start + REVIEW_START.length);
  if (start >= 0 && end >= 0) return body.slice(0, start) + section + body.slice(end + REVIEW_END.length).replace(/^\n/, '');
  const text = body.replace(/\n*$/, '');
  return text ? `${text}\n\n${section}` : section;
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

// The branch pull requests go into: BASE_BRANCH, else the current default branch of origin, else main. origin is
// asked first: the cached origin/HEAD is not refreshed by a fetch and stays on the old branch after the repository
// changes its default (main -> trunk), so it only serves when origin cannot be reached.
export function resolveBaseBranch(env = process.env) {
  if (env.BASE_BRANCH && env.BASE_BRANCH.trim()) return env.BASE_BRANCH.trim();
  try {
    const ls = sh('git', ['ls-remote', '--symref', 'origin', 'HEAD'], { timeout: 20000 });
    const m = ls.status === 0 && /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(ls.stdout);
    if (m) return m[1];
    const sym = sh('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    const ref = sym.stdout.trim();
    if (sym.status === 0 && ref.startsWith('origin/')) return ref.slice('origin/'.length);
  } catch {
    // no origin: fall through
  }
  return 'main';
}

function parseArgs(argv) {
  const opts = { base: null, fetch: true, force: false, summaryFile: null, printBase: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i];
    else if (argv[i] === '--summary-file') opts.summaryFile = argv[++i];
    else if (argv[i] === '--print-base') opts.printBase = true;
    else if (argv[i] === '--splice-summary') { opts.spliceBody = argv[++i]; opts.spliceSummary = argv[++i]; }
    else if (argv[i] === '--no-fetch') opts.fetch = false;
    else if (argv[i] === '--force') opts.force = true;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return opts;
}

// Codex runs in its own process group: the installed codex is a wrapper that starts the real binary, and a signal to
// the wrapper alone would leave that child running. The timeout and an interruption of the review (Ctrl+C, hangup,
// termination) kill the whole group; an interruption is reported to the caller, which cleans up and never approves.
const INTERRUPTS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
function runCodex(codex, args, { cwd, errFd, seconds }) {
  return new Promise((resolve) => {
    const child = spawn(codex, args, { cwd, stdio: ['ignore', 'ignore', errFd], detached: true });
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the whole group was already gone */ } };
    let timedOut = false;
    let interrupted = null;
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, seconds * 1000);
    const onSignal = (signal) => { interrupted = signal; killGroup(); };
    for (const s of INTERRUPTS) process.on(s, onSignal);
    const done = (result) => {
      clearTimeout(timer);
      for (const s of INTERRUPTS) process.off(s, onSignal);
      resolve(result);
    };
    child.on('error', (error) => { killGroup(); done({ error }); });
    child.on('exit', (status, signal) => done({ status, signal, timedOut, interrupted }));
  });
}

// Every successful exit re-checks HEAD: if the branch moved after it was captured, the current commit was not reviewed.
function moved(head) {
  const now = git('rev-parse', 'HEAD');
  if (now === head) return false;
  console.error(`The branch changed during the review (reviewed ${head.slice(0, 7)}, now ${now.slice(0, 7)}). Push through bin/pr, which reviews and pushes the exact commit.`);
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.spliceBody) {
    // bin/pr: prints the pull request body (file) with the review summary (file) in its delimited section.
    process.stdout.write(withReviewSection(readFileSync(opts.spliceBody, 'utf8'), readFileSync(opts.spliceSummary, 'utf8')));
    return 0;
  }
  const root = git('rev-parse', '--show-toplevel');
  process.chdir(root);
  if (opts.printBase) {
    console.log(resolveBaseBranch());
    return 0;
  }
  if (!opts.base) opts.base = `origin/${resolveBaseBranch()}`;
  const summarize = (text) => {
    if (opts.summaryFile) writeFileSync(opts.summaryFile, text);
  };
  // bin/pr fetches once and passes --no-fetch; run on its own, this brings the base up to date.
  // Explicit refspec: in a single-branch clone a bare `git fetch origin <branch>` only fills FETCH_HEAD.
  if (opts.fetch && opts.base.startsWith('origin/')) {
    const b = opts.base.slice('origin/'.length);
    git('fetch', '--quiet', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`);
  }

  const head = git('rev-parse', 'HEAD');
  const base = git('merge-base', opts.base, head);
  if (!git('diff', '--name-only', `${base}...${head}`)) {
    console.log('Nothing to review: the branch has no changes against the base.');
    summarize('## Local Codex review\n\nNothing to review: the branch has no changes against the base.\n');
    return 0;
  }

  // One mark per reviewed and approved commit, inside .git (never committed).
  const marksDir = join(git('rev-parse', '--git-common-dir'), 'prompt-studio-local-review');
  const mark = join(marksDir, `${head}-${base}.ok`);
  if (!opts.force && existsSync(mark)) {
    if (moved(head)) return 2;
    console.log(`Commit ${head.slice(0, 7)} was already reviewed locally with no blocking finding.`);
    const kept = readFileSync(mark, 'utf8');
    summarize(kept.startsWith('## Local Codex review') ? kept
      : `## Local Codex review\n\nCommit \`${head.slice(0, 7)}\` was already reviewed locally: **approved** (no P0, P1 or P2).\n`);
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
        console.error(`The reviewed commit has no bin/lib/${f}: update the branch with the base branch. Nothing was approved.`);
        return 2;
      }
    }
    const prompt = buildPrompt(readFileSync(join(controls, 'review-prompt.md'), 'utf8'), { base, head });
    // Codex errors go to a file, not a pipe: a hung Codex with children cannot keep this script waiting after the kill.
    const errFile = join(work, 'codex-stderr.txt');
    const errFd = openSync(errFile, 'w');
    const seconds = codexTimeoutSeconds();
    let r;
    try {
      r = await runCodex(codex, [
        'exec', '--sandbox', 'read-only', '--ephemeral', '--color', 'never',
        '-c', 'model_reasoning_effort="high"',
        '--output-schema', join(controls, 'review-schema.json'),
        '-o', out, prompt,
      ], { cwd: tree, errFd, seconds });
    } finally {
      closeSync(errFd);
    }
    if (r.interrupted) {
      console.error(`Review interrupted (${r.interrupted}); Codex was stopped. Nothing was approved.`);
      return 2;
    }
    if (r.timedOut) {
      console.error(`Codex did not answer within ${seconds}s (CODEX_TIMEOUT_SECONDS) and was stopped. Nothing was approved.`);
      return 2;
    }
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const tail = existsSync(errFile) ? readFileSync(errFile, 'utf8').split('\n').slice(-15).join('\n') : '';
      console.error(`Codex failed (exit ${r.status}). Nothing was approved.\n${tail}`);
      return 2;
    }
    const findings = parseReviewOutput(existsSync(out) ? readFileSync(out, 'utf8') : '');
    for (const f of findings) {
      console.log(`- [${f.severity}] ${f.title} (${f.path}:${f.line})\n  ${f.explanation}`);
    }
    const { counts, blocking } = decide(findings);
    console.log(`Result: P0 ${counts.P0}, P1 ${counts.P1}, P2 ${counts.P2}, P3 ${counts.P3}.`);
    const summary = formatSummary({ head, base, findings, counts, blocking });
    summarize(summary);
    if (blocking) {
      console.log('Fix the P0, P1 and P2 findings before the push. For an unfounded finding, ask the maintainer; bin/pr --skip-review only with their authorization.');
      return 1;
    }
    mkdirSync(marksDir, { recursive: true });
    writeFileSync(mark, summary);
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
    process.exitCode = await main();
  } catch (e) {
    console.error(`Local review stopped: ${e.message}`);
    process.exitCode = 2;
  }
}
