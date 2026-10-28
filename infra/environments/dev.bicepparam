// The Stride dev environment. None of these is a secret. Replace every REPLACE_ME before the first
// deployment (infra/deploy.sh refuses to run while one remains).
using '../main.bicep'

param environmentName = 'dev'
param owner = 'REPLACE_ME'
param alertEmail = 'REPLACE_ME'
param budgetStartDate = '2026-11-01T00:00:00Z'

// The External ID tenant and its stride-api app registration (docs/runbook.md).
param entraTenantId = 'REPLACE_ME'
param entraApiClientId = 'REPLACE_ME'

// StatEdge staff who run the staff scripts against this database, with their Entra object ids
// (az ad user show --id <upn> --query id). For example:
//   { upn: 'founder@statedge.co.za', objectId: '00000000-0000-0000-0000-000000000000' }
param sqlStaffUsers = []
