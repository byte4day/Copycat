#!/usr/bin/env node
// Remove Copycat files recorded in the install ledger. Never touches paths
// Copycat did not create; keeps modified files unless --force (backed up).
import { parseInstallArgs, tilde } from './lib/cli.mjs';
import { PLATFORMS, EXIT, uninstallTargets, uninstallRuntime, readLedger } from './lib/installer.mjs';

const HELP = `Uninstall Copycat (only files recorded in its install ledger).

  node scripts/uninstall.mjs --all --global
  node scripts/uninstall.mjs --platform cursor --global
  node scripts/uninstall.mjs --all --project [--dir .]
Options: --dry-run --force --keep-runtime --json`;

async function main() {
  const o = parseInstallArgs(process.argv.slice(2), ['keep-runtime']);
  if (o.help) {
    console.log(HELP);
    return EXIT.OK;
  }
  const platforms = /** @type {any[]} */ (o.all ? [...PLATFORMS] : o.platforms);
  const root = o.project ? o.dir : o.home;
  const res = await uninstallTargets(platforms, { ledgerRoot: root, force: o.force, dryRun: o.dryRun });
  let runtime = null;
  const globalLedger = readLedger(o.home);
  const anyLeft = globalLedger.entries.length > 0 || (o.project ? false : res.ledger.entries.length > 0);
  if (!o.keepRuntime && o.all && !o.project && !anyLeft) runtime = await uninstallRuntime({ home: o.home, dryRun: o.dryRun });
  const code = res.kept ? EXIT.CONFLICT : EXIT.OK;
  if (o.json) console.log(JSON.stringify({ dryRun: o.dryRun, steps: res.steps, runtime, exitCode: code }, null, 2));
  else {
    console.log(`Copycat uninstall${o.dryRun ? ' — DRY RUN, nothing changed' : ''}`);
    if (!res.steps.length) console.log('Nothing recorded for the selected platforms.');
    for (const s of res.steps) console.log(`${s.kind.padEnd(9)} ${s.action.padEnd(22)} ${tilde(s.dest, o.home)}${s.detail ? `  (${s.detail})` : ''}${s.backup ? `\n          ↳ backup: ${tilde(s.backup, o.home)}` : ''}`);
    if (runtime) console.log(`runtime   ${runtime.action.padEnd(22)} ${runtime.dest ? tilde(runtime.dest, o.home) : ''}`);
  }
  return code;
}

main().then((c) => process.exit(c), (e) => {
  console.error(`uninstall: ${e.message}`);
  process.exit(e.usage ? EXIT.USAGE : EXIT.FAILURE);
});
