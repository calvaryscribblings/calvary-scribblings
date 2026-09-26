// The harness's only loader: JSX through Next's own SWC, so the proof bundles the real
// ConversationKit (JSX) with no bundler added to the repo.
const swc = require('next/dist/build/swc');
module.exports = function swcLoader(src) {
  const done = this.async();
  swc.loadBindings()
    .then(() => swc.transform(src, { filename: this.resourcePath, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } } }))
    .then((r) => done(null, r.code), done);
};
