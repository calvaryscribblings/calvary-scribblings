// W16 — the build this page is running, where a reader can read it: under the story's closing
// footer and in the site footer, as the app's Profile footer shows its version. Every walk of the
// live site can now confirm what the phone is actually running (compare /build.json). The ID is
// public already — every page and sw.js carry it.
import { BUILD_COMMIT } from '../lib/buildId';

export default function BuildStamp({ tone = 'cream', style }) {
  // 4.80:1 on the cream reading ground (#f0ead8); 5.84:1 on the footer's #111.
  const color = tone === 'cream' ? '#6b655b' : '#8f8f8f';
  return (
    <p data-build-stamp="" style={{ margin: 0, textAlign: 'center', color, fontSize: '0.72rem', letterSpacing: '0.08em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', ...style }}>
      Build {BUILD_COMMIT}
    </p>
  );
}
