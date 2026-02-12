# @ixo/oracles-events

## 1.0.3

### Patch Changes

- **Fix:** Published tarball now includes `ActionCallEvent` (dist/events/action-call). v1.0.2 on npm was built from a tree that omitted this export; ensure you run `pnpm build` before publishing. Added `prepublishOnly` script so `pnpm publish` always builds first.

## 1.0.2

- (Published 1.0.2 on npm was missing `ActionCallEvent` in dist; use 1.0.3.)

## 1.0.1

### Patch Changes

- [#53](https://github.com/ixoworld/ixo-oracles-boilerplate/pull/53) [`0a4a5a8`](https://github.com/ixoworld/ixo-oracles-boilerplate/commit/0a4a5a84194acb851e3824e0b74eea54f60c8257) Thanks [@youssefhany-ixo](https://github.com/youssefhany-ixo)! - Upgrade packages and publish events package and preformance upgrades
