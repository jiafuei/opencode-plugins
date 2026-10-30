# prune.js build source

Maintainer files for `../scripts/prune.js`. They are not part of the installed skill:
install only `SKILL.md`, `THIRD_PARTY_LICENSES.txt`, and `scripts/`.

To rebuild, edit `prune.ts`, make the locked dependencies available in
`node_modules`, then run `bun run build` here. Commit `prune.ts`, `package.json`,
`bun.lock`, and `../scripts/prune.js` together.

When the bundled packages change, regenerate `../THIRD_PARTY_LICENSES.txt`. List the
bundled packages with `bun build prune.ts --target=bun --metafile=meta.json`, then
copy each package's license file. `boolbase` ships no license file; its notice is
written from its declared ISC license.
