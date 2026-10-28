// One Stride environment, deployed at subscription scope so that it can create its resource
// group and the custom role for the pipeline. Run it through the deploy script, which also points
// the GitHub environment at what it created:
//
//   infra/deploy.sh dev            (or prod; see infra/README.md)
//
// Names follow <type>-stride-<env>-<region>. Everything is in South Africa North except the
// Static Web App, which is not offered there.

targetScope = 'subscription'

@description('dev or prod.')
@allowed([
  'dev'
  'prod'
])
param environmentName string

@description('Region for everything except the Static Web App.')
param location string = 'southafricanorth'

@description('Region code in resource names.')
param locationShort string = 'san'

@description('Static Web Apps is not offered in South Africa North. It serves static files only.')
param staticWebAppLocation string = 'westeurope'

@description('Owner tag.')
param owner string

@description('Who budget and alert emails go to (the founder).')
param alertEmail string

@description('Resource-group budget in US dollars, with notifications at 50, 80 and 100 percent.')
param monthlyBudgetUsd int = 15

@description('First day of the first budget month, as YYYY-MM-01T00:00:00Z. Must not be in the past when the budget is first created.')
param budgetStartDate string

@description('The External ID (customer) tenant that signs coaches in.')
param entraTenantId string

@description('Client id of the stride-api app registration: the audience of access tokens.')
param entraApiClientId string

@description('owner/name of the application repository, trusted by the deploy identity.')
param githubRepository string = 'BosCaleb/statedge_stride'

@description('Custom hostname for the web app, such as stride.statedge.co.za. Empty for none.')
param customDomain string = ''

@description('Phase two of the custom domain: true once the CNAME at the DNS host points at the Static Web App.')
param customDomainDnsReady bool = false

@description('Daily ingestion cap for Log Analytics and Application Insights, in GB.')
param logDailyCapGb string = '0.1'

@description('Alert when daily executions pass this (the free grant is about 33,000 a day).')
param functionExecutionsPerDayAlert int = 25000

@description('Protect the database from deletion with a CanNotDelete lock.')
param lockDatabase bool = true

@description('An Entra person who runs the staff scripts against this database.')
type staffUser = {
  @description('User principal name, used as the database user name.')
  upn: string

  @description('Object id: the database user is created from it.')
  objectId: string
}

@description('StatEdge staff who get the API\'s database rights. Read by the deploy workflow, not by Azure.')
param sqlStaffUsers staffUser[] = []

@description('GitHub user ids who approve production deploys. Read by infra/deploy.sh, not by Azure.')
param githubReviewerUserIds int[] = []

@description('Extra tags.')
param tags object = {}

var suffix = 'stride-${environmentName}-${locationShort}'
var allTags = union(tags, {
  environment: environmentName
  owner: owner
  application: 'stride'
})

resource group 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${suffix}'
  location: location
  tags: allTags
}

// The pipeline may read the Static Web App's deployment token, nothing more. No built-in role is
// that narrow.
resource tokenReader 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, group.id, 'stride-static-web-app-token-reader')
  properties: {
    roleName: 'Stride ${environmentName} static web app token reader'
    description: 'Reads the deployment token of the Stride ${environmentName} static web app.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Web/staticSites/read'
          'Microsoft.Web/staticSites/listSecrets/action'
        ]
        notActions: []
      }
    ]
    assignableScopes: [
      group.id
    ]
  }
}

module stride 'modules/stride.bicep' = {
  name: 'stride-${environmentName}-resources'
  scope: group
  params: {
    environmentName: environmentName
    location: location
    locationShort: locationShort
    staticWebAppLocation: staticWebAppLocation
    tags: allTags
    alertEmail: alertEmail
    monthlyBudgetUsd: monthlyBudgetUsd
    budgetStartDate: budgetStartDate
    entraTenantId: entraTenantId
    entraApiClientId: entraApiClientId
    githubRepository: githubRepository
    customDomain: customDomain
    customDomainDnsReady: customDomainDnsReady
    logDailyCapGb: logDailyCapGb
    functionExecutionsPerDayAlert: functionExecutionsPerDayAlert
    lockDatabase: lockDatabase
    tokenReaderRoleId: tokenReader.id
  }
}

// Read by infra/deploy.sh for the GitHub environment. None of them is a secret.
output githubRepository string = githubRepository
output githubReviewerUserIds int[] = githubReviewerUserIds
output azureTenantId string = tenant().tenantId
output azureSubscriptionId string = subscription().subscriptionId
output resourceGroup string = group.name
output deployClientId string = stride.outputs.deployClientId
output functionAppName string = stride.outputs.functionAppName
output staticWebAppName string = stride.outputs.staticWebAppName
output webHostname string = stride.outputs.webHostname
output webUrl string = stride.outputs.webUrl
output apiUrl string = stride.outputs.apiUrl
output sqlServer string = stride.outputs.sqlServer
output sqlDatabase string = stride.outputs.sqlDatabase
output apiIdentityName string = stride.outputs.apiIdentityName
output apiIdentityClientId string = stride.outputs.apiIdentityClientId
output sqlStaffUsers string = join(map(sqlStaffUsers, u => '${u.upn}=${u.objectId}'), ',')

@description('Public ingestion settings for APPLICATIONINSIGHTS_CONNECTION_STRING in the web build.')
output appInsightsConnectionString string = stride.outputs.appInsightsConnectionString
