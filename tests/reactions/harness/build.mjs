// W13 proof harness — bundles entry.js (the real Reaction + ReactionRow) with the webpack Next
// ships, into <outDir>/bundle.js. No bundler is added to package.json.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

export async function buildHarness(outDir, { alias = {} } = {}) {
  const w = require('next/dist/compiled/webpack/webpack');
  w.init?.();
  const compiler = w.webpack({
    mode: 'production',
    context: here,
    entry: join(here, 'entry.js'),
    output: { path: outDir, filename: 'bundle.js', publicPath: '/' },
    devtool: false,
    resolve: { alias, modules: [join(here, '../../../node_modules'), 'node_modules'] },
    resolveLoader: { modules: [here, 'node_modules'] },
    module: { rules: [{ test: /\.m?js$/, exclude: /node_modules/, use: join(here, 'swc-loader.cjs') }] },
    optimization: { minimize: false },
    performance: { hints: false },
  });
  await new Promise((res, rej) => compiler.run((err, stats) => {
    if (err) return rej(err);
    if (stats.hasErrors()) return rej(new Error(stats.toString({ all: false, errors: true })));
    res();
  }));
  return join(outDir, 'bundle.js');
}
