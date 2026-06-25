# Contributing

Thanks for your interest in improving **CBM — Coolify Backup Manager**! Contributions of all
kinds are welcome — bug reports, fixes, features, and docs.

By contributing, you agree that your contributions are licensed under the project's
[Apache-2.0 license](./LICENSE).

## Project layout

This is an npm-workspaces monorepo:

- `packages/shared` (`@cbm/shared`) — the zod-typed job/manifest contract shared by both
  sides. Build it first; the others depend on it.
- `packages/agent` (`@cbm/agent`) — runs on each Docker host: dumps databases, archives
  volumes, transfers to destinations. Talks to the Docker CLI.
- `packages/controller` (`@cbm/controller`) — the Next.js web app: panel, API, scheduler,
  and the metadata database (Prisma).

## Development setup

```bash
npm install
docker compose -f docker-compose.dev.yml up -d                 # controller Postgres on :5544
cp packages/controller/.env.example packages/controller/.env   # then edit the secrets
npm run db:push --workspace @cbm/controller
npm run dev --workspace @cbm/controller                        # http://localhost:3000
```

To run an agent locally against your controller:

```bash
npm run build --workspace @cbm/shared && npm run build --workspace @cbm/agent
CONTROLLER_URL=http://localhost:3000 ENROLLMENT_TOKEN=cbm_… \
  node packages/agent/dist/index.js
```

## Before opening a pull request

```bash
npm run build:shared                 # shared types must compile first
npm test                             # unit tests (shared + agent)
# In packages/controller:
npx tsc --noEmit                     # type-check the controller
```

- Keep pull requests **focused** — one logical change per PR.
- Match the **style of the surrounding code** (TypeScript, existing naming and comment
  density). No new formatter/lint config in a feature PR.
- If you change the Prisma schema, add a **migration** under
  `packages/controller/prisma/migrations/` (the deploy step runs `prisma migrate deploy`).
- If you change the agent/controller contract, update `@cbm/shared` and rebuild it.
- Update the README if you change user-facing behavior or add/remove a limitation.

## Documentation

The detailed docs live in **[`/docs`](docs/)** (versioned with the code — there is no separate
GitHub Wiki). When you change user-facing behavior, update the relevant page(s) in `/docs` in the
same PR, and the [README](README.md) if it affects the overview or limitations. Screenshots used
by the README/docs live in `docs/screenshots/`.

## Reporting bugs

Open a GitHub issue with: what you did, what you expected, what happened, and your Coolify
version. Logs from the snapshot/restore page help a lot.

## Security

Please **do not** open a public issue for a security vulnerability. Report it privately to
the maintainer instead.

## Database backups are serious

This tool moves and deletes data. When changing backup, restore, or pruning logic, test on
throwaway resources and verify a real restore — never assume.
