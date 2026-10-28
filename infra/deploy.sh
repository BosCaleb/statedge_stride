#!/usr/bin/env bash
# Deploys one Stride environment with Bicep, then points its GitHub environment at it.
#
#   infra/deploy.sh dev              deploy dev (or prod)
#   infra/deploy.sh dev --what-if    show what would change in Azure, change nothing
#
# Needs the Azure CLI signed in as an Owner of the subscription (the templates create a custom
# role, role assignments and a lock), the GitHub CLI signed in as an administrator of the
# repository, and jq. Safe to run again: it converges on the same result.
set -euo pipefail

env="${1:-}"
mode="${2:-}"
case "$env" in
  dev | prod) ;;
  *)
    echo "usage: infra/deploy.sh dev|prod [--what-if]" >&2
    exit 2
    ;;
esac
here="$(cd "$(dirname "$0")" && pwd)"
params="$here/environments/$env.bicepparam"
name="stride-$env"
location="southafricanorth"

if grep -q 'REPLACE_ME' "$params"; then
  echo "error: $params still has REPLACE_ME values (see infra/README.md)" >&2
  exit 1
fi

if [ "$mode" = "--what-if" ]; then
  az deployment sub what-if --name "$name" --location "$location" --parameters "$params"
  exit 0
fi

echo "Deploying $name to Azure..."
az deployment sub create --name "$name" --location "$location" --parameters "$params" \
  --output none
outputs="$(az deployment sub show --name "$name" --query properties.outputs --output json)"
out() { jq -r --arg key "$1" '.[$key].value' <<<"$outputs"; }

repo="$(out githubRepository)"
branch="dev"
[ "$env" = "prod" ] && branch="main"

echo "Configuring the $env environment of $repo on GitHub..."
# Deploys only from the environment's branch; production waits for a reviewer when one is set.
jq -n --argjson ids "$(jq -c '.githubReviewerUserIds.value' <<<"$outputs")" '{
  reviewers: [$ids[] | {type: "User", id: .}],
  deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}
}' | gh api --method PUT "repos/$repo/environments/$env" --input - >/dev/null
policies="$(gh api "repos/$repo/environments/$env/deployment-branch-policies" \
  --jq '.branch_policies[].name')"
if ! grep -qx "$branch" <<<"$policies"; then
  gh api --method POST "repos/$repo/environments/$env/deployment-branch-policies" \
    -f name="$branch" -f type=branch >/dev/null
fi

# The variables the deploy workflow reads. None is a secret: the workflow reads the Static Web
# App deployment token itself, with the same OIDC sign-in.
set_var() {
  if [ -n "$2" ]; then
    gh variable set "$1" --repo "$repo" --env "$env" --body "$2"
  else
    gh variable delete "$1" --repo "$repo" --env "$env" 2>/dev/null || true
  fi
}
set_var AZURE_CLIENT_ID "$(out deployClientId)"
set_var AZURE_TENANT_ID "$(out azureTenantId)"
set_var AZURE_SUBSCRIPTION_ID "$(out azureSubscriptionId)"
set_var RESOURCE_GROUP "$(out resourceGroup)"
set_var FUNCTION_APP_NAME "$(out functionAppName)"
set_var STATIC_WEB_APP_NAME "$(out staticWebAppName)"
set_var API_URL "$(out apiUrl)"
set_var WEB_URL "$(out webUrl)"
set_var SQL_SERVER "$(out sqlServer)"
set_var SQL_DATABASE "$(out sqlDatabase)"
set_var API_IDENTITY_NAME "$(out apiIdentityName)"
set_var API_IDENTITY_CLIENT_ID "$(out apiIdentityClientId)"
set_var SQL_STAFF_USERS "$(out sqlStaffUsers)"

cat <<EOF

Done. For apps/web/.env.$env:
  VITE_API_BASE_URL=$(out apiUrl)
  APPLICATIONINSIGHTS_CONNECTION_STRING=$(out appInsightsConnectionString)
Web hostname (the CNAME target for a custom domain): $(out webHostname)
EOF
