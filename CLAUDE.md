# StatEdge Stride

Web app for coaches to analyse running technique from phone slow-motion video.
Analysis runs on the phone. See docs/spec.md (the MVP specification) for detail, and
docs/decisions.md for every place the build differs from or adds to the spec.

## Stack

React 18 + TypeScript + Vite PWA, Azure Functions (Node 22, TypeScript, v4 model), Azure SQL,
Entra External ID, MediaPipe Pose Landmarker, pnpm monorepo.

## Layout

apps/web, apps/api, packages/shared (zod schemas), packages/analysis (pure TS).
fixtures/ holds keypoint files (never video of identifiable people). scripts/ holds create-org,
seed, db-migrate, fetch-models, licence and OpenAPI tools. infra/ holds the Terraform module that
belongs in the statedge-infra repository.

## Commands

pnpm dev | pnpm test | pnpm test:db | pnpm lint | pnpm typecheck | pnpm db:up | pnpm db:migrate |
pnpm seed | pnpm e2e | pnpm licences | pnpm openapi | pnpm fetch-models

## Rules

- packages/analysis has no DOM, network or model imports. Keep it pure and tested.
- All tunable values live in packages/analysis/src/config.ts. Changing one means bumping
  ALGORITHM_VERSION and recording the new fingerprint in config.test.ts.
- Parse every boundary with zod. No any. No string-built SQL.
- Every query on org data goes through withOrg(). RLS must fail closed.
- Never show a metric without a confidence label. Never show good or bad judgements.
- Video stays on the device by default. No athlete names in URLs, logs or telemetry.
- No secrets in the repo. Managed identity and GitHub OIDC only.
- Only MIT, Apache-2.0, BSD or ISC production dependencies. No AGPL or GPL anywhere.
- No default exports (except framework config files) and no barrel files.
- All user-facing strings go through apps/web/src/lib/strings.ts.
- Do not add dependencies or services without asking.
- Work milestone by milestone and stop at each gate.
