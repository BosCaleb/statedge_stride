// The Stride prod environment. None of these is a secret. Replace every REPLACE_ME before the first
// deployment (infra/deploy.sh refuses to run while one remains).
using '../main.bicep'

param environmentName = 'prod'
param owner = 'REPLACE_ME'
param alertEmail = 'REPLACE_ME'
param budgetStartDate = '2026-11-01T00:00:00Z'

// The External ID tenant and its stride-api app registration (docs/runbook.md).
param entraTenantId = 'REPLACE_ME'
param entraApiClientId = 'REPLACE_ME'

// Phase two of the custom domain: set true once the CNAME at GoDaddy points at the web hostname.
param customDomain = 'stride.statedge.co.za'
param customDomainDnsReady = false

// GitHub user ids who approve production deploys (gh api users/<login> --jq .id).
param githubReviewerUserIds = []

// StatEdge staff who run the staff scripts against this database, with their Entra object ids
// (az ad user show --id <upn> --query id). For example:
//   { upn: 'founder@statedge.co.za', objectId: '00000000-0000-0000-0000-000000000000' }
param sqlStaffUsers = []
