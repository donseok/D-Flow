// python argparse 규약을 따라 하는 얇은 인자 파서 (util.parseArgs 기반, 외부 의존 0).
//  - 알 수 없는 옵션·필수 누락·잘못된 choices·초과 위치 인자 → 사용 오류: stderr 에 `사용: …` 와
//    `<prog>: 오류: …` 를 쓰고 종료 코드 2.
//  - process.exit() 를 부르지 않는다. 오류·도움말이면 process.exitCode 를 지정하고 null 을 돌려주므로
//    호출 쪽은 `const cli = parseCli(argv, spec); if (!cli) return;` 로 끝낸다.
//  - 한계: argparse 의 긴 옵션 접두 축약(--ver → --verbose), 음수 위치 인자·`--n -5` 처럼 옵션 값이 `-` 로 시작하는 음수는 지원하지 않는다(사용 오류 2. argparse 는 받는다).
//    결과 키는 옵션 이름 그대로다(`dry-run` 은 `values['dry-run']`, argparse 의 dry_run 과 다름).
//
// spec 형태
//   { prog?, description?, options?, positionals?, commands?, commandRequired?: true }
//   options:     { name: { type: 'string'|'boolean'|'int'|'number', short?, multiple?, required?, choices?, default?, help? } }
//   positionals: [ { name, required?: true, variadic?: false, choices?, type?, help? } ]
//   commands:    { cmd: { options?, positionals?, help? } }   // 서브커맨드(전역 옵션은 명령 앞에 둔다)
// 결과: { command, values, positionals }  (서브커맨드가 없으면 command 는 null, values 는 전역+명령 옵션 병합)

import path from 'node:path';
import { parseArgs } from 'node:util';
import { OK, VIOLATION, USAGE, finish } from './exit.mjs';

export { OK, VIOLATION, USAGE, finish };

class UsageError extends Error {}

function defaultProg() {
  return path.basename(process.argv[1] ?? 'node');
}

/**
 * 사용 오류를 stderr 에 쓰고 종료 코드를 2 로 지정한다(종료는 호출 쪽이 return 으로).
 * 출력: `사용: <usage>` + `<prog>: 오류: <msg>`
 */
export function exitUsage(msg, { usage, prog, stderr = process.stderr } = {}) {
  const p = prog ?? defaultProg();
  stderr.write(`사용: ${usage ?? p}\n${p}: 오류: ${msg}\n`);
  return finish(USAGE);
}

function usageLine(prog, spec, cmdName) {
  const parts = [prog];
  if (spec.commands && !cmdName) parts.push(`{${Object.keys(spec.commands).join(',')}}`);
  if (cmdName) parts.push(cmdName);
  const opts = { ...(spec.options ?? {}), ...(cmdName ? spec.commands[cmdName].options ?? {} : {}) };
  for (const [name, o] of Object.entries(opts)) {
    const flag = o.type === 'boolean' ? `--${name}` : `--${name} ${name.toUpperCase()}`;
    parts.push(o.required ? flag : `[${flag}]`);
  }
  const poss = cmdName ? spec.commands[cmdName].positionals ?? [] : spec.positionals ?? [];
  for (const p of poss) {
    const n = p.variadic ? `${p.name}...` : p.name;
    parts.push(p.required === false ? `[${n}]` : n);
  }
  return parts.join(' ');
}

function parseError(e) {
  const q = /'([^']+)'/.exec(e.message ?? '');
  switch (e.code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `알 수 없는 옵션: ${q ? q[1] : e.message}`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return `옵션 값이 잘못되었거나 없음: ${q ? q[1] : e.message}`;
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return `인식할 수 없는 인자: ${q ? q[1] : e.message}`;
    default:
      return String(e.message ?? e).split('\n')[0];
  }
}

function convert(name, raw, o) {
  let v = raw;
  if (o.type === 'int') {
    if (!/^[+-]?\d+$/.test(raw)) throw new UsageError(`--${name}: 정수가 필요함 (입력 '${raw}')`);
    v = parseInt(raw, 10);
  } else if (o.type === 'number') {
    const x = Number(raw);
    if (raw.trim() === '' || Number.isNaN(x)) throw new UsageError(`--${name}: 숫자가 필요함 (입력 '${raw}')`);
    v = x;
  }
  if (o.choices && !o.choices.map(String).includes(String(v))) {
    throw new UsageError(`--${name}: 잘못된 값 '${raw}' (choices: ${o.choices.join(', ')})`);
  }
  return v;
}

function parseLevel(argv, options = {}, positionals = []) {
  const pa = {};
  for (const [name, o] of Object.entries(options)) {
    pa[name] = { type: o.type === 'boolean' ? 'boolean' : 'string' };
    if (o.short) pa[name].short = o.short;
    if (o.multiple) pa[name].multiple = true;
  }
  if (!pa.help) pa.help = { type: 'boolean', ...(Object.values(options).some((o) => o.short === 'h') ? {} : { short: 'h' }) };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: pa, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError(parseError(e));
  }
  if (parsed.values.help && !options.help) return { help: true };

  const values = {};
  for (const [name, o] of Object.entries(options)) {
    const raw = parsed.values[name];
    if (raw === undefined) {
      if (o.required && o.type !== 'boolean') throw new UsageError(`다음 인자가 필요함: --${name}`);
      values[name] = o.default !== undefined ? o.default : o.type === 'boolean' ? false : o.multiple ? [] : undefined;
    } else if (o.type === 'boolean') {
      values[name] = raw;
    } else if (o.multiple) {
      values[name] = raw.map((x) => convert(name, x, o));
    } else {
      values[name] = convert(name, raw, o);
    }
  }
  if (parsed.values.help && options.help) values.help = parsed.values.help;

  const rest = [...parsed.positionals];
  const pos = {};
  for (const p of positionals) {
    const req = p.required !== false;
    if (p.variadic) {
      if (req && rest.length === 0) throw new UsageError(`다음 인자가 필요함: ${p.name}`);
      pos[p.name] = rest.splice(0).map((x) => convert(p.name, x, p).valueOf());
      continue;
    }
    if (rest.length === 0) {
      if (req) throw new UsageError(`다음 인자가 필요함: ${p.name}`);
      pos[p.name] = p.default;
      continue;
    }
    pos[p.name] = convert(p.name, rest.shift(), p);
  }
  if (rest.length) throw new UsageError(`인식할 수 없는 인자: ${rest.join(' ')}`);
  return { values, positionals: pos };
}

/** 첫 위치 인자(서브커맨드) 위치를 찾는다. 전역 문자열 옵션의 값은 건너뛴다. */
function findCommandIndex(argv, options = {}) {
  const short = {};
  for (const [n, o] of Object.entries(options)) if (o.short) short[o.short] = [n, o];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') return -1;
    if (t.startsWith('--')) {
      if (t.includes('=')) continue;
      const o = options[t.slice(2)];
      if (o && o.type !== 'boolean') i++;
    } else if (t.startsWith('-') && t.length > 1) {
      const e = short[t[1]];
      if (e && e[1].type !== 'boolean' && t.length === 2) i++;
    } else {
      return i;
    }
  }
  return -1;
}

/**
 * argv(= process.argv.slice(2)) 를 spec 대로 해석한다. 사용 오류·도움말이면 null 을 돌려주고
 * process.exitCode 를 지정해 둔다(오류 2, 도움말 0).
 * @param {{stderr?: {write:Function}, stdout?: {write:Function}}} [io] 시험용 출력 대체
 */
export function parseCli(argv, spec = {}, io = {}) {
  const stderr = io.stderr ?? process.stderr;
  const stdout = io.stdout ?? process.stdout;
  const prog = spec.prog ?? defaultProg();
  const help = (cmdName) => {
    const lines = [`사용: ${usageLine(prog, spec, cmdName)}`];
    if (spec.description) lines.push('', spec.description);
    stdout.write(lines.join('\n') + '\n');
    finish(OK);
    return null;
  };
  let currentCmd = null;
  try {
    if (!spec.commands) {
      const r = parseLevel(argv, spec.options, spec.positionals);
      if (r.help) return help(null);
      return { command: null, values: r.values, positionals: r.positionals };
    }
    const idx = findCommandIndex(argv, spec.options);
    const names = Object.keys(spec.commands);
    if (idx < 0) {
      const g = parseLevel(argv, spec.options, []);
      if (g.help) return help(null);
      if (spec.commandRequired !== false) throw new UsageError(`명령이 필요함 (choices: ${names.join(', ')})`);
      return { command: null, values: g.values, positionals: {} };
    }
    const cmd = argv[idx];
    if (!names.includes(cmd)) throw new UsageError(`잘못된 명령 '${cmd}' (choices: ${names.join(', ')})`);
    currentCmd = cmd;
    const g = parseLevel(argv.slice(0, idx), spec.options, []);
    if (g.help) return help(null);
    const c = parseLevel(argv.slice(idx + 1), spec.commands[cmd].options, spec.commands[cmd].positionals);
    if (c.help) return help(cmd);
    return { command: cmd, values: { ...g.values, ...c.values }, positionals: c.positionals };
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    exitUsage(e.message, { usage: usageLine(prog, spec, currentCmd), prog, stderr });
    return null;
  }
}
