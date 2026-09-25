// Preload for a build "as if" at another moment: node --import ./tests/build/fake-clock.mjs.
// FAKE_NOW (ms or ISO) shifts Date.now() — the only clock the story gate reads — by a fixed
// offset, so time still advances during the build. Used by the W4 built-HTML check only.
const raw = process.env.FAKE_NOW;
if (raw) {
  const target = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (Number.isFinite(target)) {
    const realNow = Date.now.bind(Date);
    const offset = target - realNow();
    Date.now = () => realNow() + offset;
  }
}
