# StatEdge Stride

A web app for coaches to analyse running technique from phone slow-motion video. The analysis (decoding, pose estimation, events, metrics) runs on the phone; a small Azure API stores results. Video stays on the device by default.

- Specification: [docs/spec.md](docs/spec.md)
- Where the build differs from or adds to it: [docs/decisions.md](docs/decisions.md)
- Spike measurements (M0): [docs/spike-report.md](docs/spike-report.md)
- Setting up, deploying and operating: [docs/runbook.md](docs/runbook.md)
- Infrastructure: [infra/README.md](infra/README.md)

## Layout

| Path                | What                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web`          | React 18 + Vite installable PWA. `src/analysis-runtime` holds the decoder, pose estimator and worker |
| `apps/api`          | Azure Functions (Node 22, v4 model). `migrations/` holds the numbered SQL files                      |
| `packages/shared`   | zod schemas: API contract, analysis result, report snapshot, enums                                   |
| `packages/analysis` | Pure TypeScript analysis engine: filters, events, metrics, confidence, gate                          |
| `fixtures`          | Keypoint fixtures (never video of identifiable people) and tiny synthetic test clips                 |
| `scripts`           | Staff and developer tools: migrate, create-org, seed, dev, licences, OpenAPI, models                 |
| `infra`             | Terraform module and environments (to move to `statedge-infra`)                                      |

## Quick start

```bash
pnpm install
pnpm db:up && pnpm db:migrate && pnpm seed
pnpm fetch-models
pnpm dev
```

Then open http://localhost:5173 and sign in as one of the seeded people.

## Commands

| Command                                      | Does                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                   | Web, API and (with Core Tools) Azurite                                          |
| `pnpm test`                                  | Unit, fixture and contract tests                                                |
| `pnpm test:db`                               | API tests against SQL Server in Docker                                          |
| `pnpm e2e`                                   | Playwright smoke tests (build first with `pnpm --filter @stride/web build:e2e`) |
| `pnpm lint`, `pnpm typecheck`                | ESLint, Prettier, Stylelint; TypeScript                                         |
| `pnpm db:up`, `pnpm db:migrate`, `pnpm seed` | Local database                                                                  |
| `pnpm create-org`                            | Create an organisation and its first admin invite                               |
| `pnpm licences`                              | Licence allowlist check                                                         |
| `pnpm openapi`                               | Regenerate `apps/api/openapi.json`                                              |
| `pnpm fetch-models`                          | Download the pinned pose model and WASM runtime                                 |
