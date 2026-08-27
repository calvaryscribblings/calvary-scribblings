// A driver for the build-read contract, run as a CHILD PROCESS by tests/build/liveness.test.mjs.
//
// ⚠ A CHILD PROCESS, NOT AN IMPORT, AND THAT IS THE POINT. buildRead's failure path is
// `process.exit(1)` after writing to fd 1 — the exit code and the message ARE the behaviour
// under test, and neither is observable from inside the same process. Testing it in-process
// would have meant adding an injectable exit to production code, i.e. testing a shape built for
// the test rather than the thing that ships.
//
// ⚠ THE DEADLINE AND BACKOFF ARE SHRUNK HERE, ON PURPOSE AND VISIBLY. BUILD_READ is a plain
// object; this driver overwrites two of its numbers so the fault cases take milliseconds
// instead of the real 4 × 20s + 12s = 92s. The SHIPPED numbers are asserted separately, by
// name, in the suite — and the real 20s deadline is exercised end to end by the script timeout
// case, which pays the full 92s once rather than in every test.
import { BUILD_READ, buildRead, buildReadOptional } from '../../../app/lib/build-read.mjs';

BUILD_READ.timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 300);
BUILD_READ.backoffMs = [5, 5, 5];

const mode = process.argv[2];
let calls = 0;

const read = async () => {
  calls += 1;
  switch (mode) {
    // The failure that started PL-12: a promise that never settles. This is what
    // firebase/database's get() does against an unreachable database — measured at 75s on DNS
    // failure, connection refused and dropped packets alike.
    case 'hang':
    case 'optional-hang':
      return new Promise(() => {});
    case 'throw':
      throw new Error('PERMISSION_DENIED: Permission denied');
    // Fails twice, then answers. The retry has to earn its place.
    case 'flaky':
      if (calls < 3) throw new Error('transient');
      return { ok: true };
    // A successful read that returned nothing. MUST stay green — it is the launch-day state.
    case 'empty':
      return {};
    default:
      throw new Error(`unknown mode ${mode}`);
  }
};

if (mode === 'optional-hang') {
  const v = await buildReadOptional('cms_stories_index', { degraded: true }, 'decoration only', read);
  process.stdout.write(`RESULT ${JSON.stringify(v)} calls=${calls}\n`);
} else if (mode === 'optional-no-why') {
  try {
    await buildReadOptional('x', null, '', async () => ({}));
    process.stdout.write('RESULT no-error\n');
  } catch (e) {
    process.stdout.write(`THREW ${e.message}\n`);
  }
} else {
  const v = await buildRead('cms_stories', '/stories/[slug] — every story page', read);
  process.stdout.write(`RESULT ${JSON.stringify(v)} calls=${calls}\n`);
}
process.exit(0);
