// Everything in a Stride resource group: the static web app, the Function App on the
// Consumption plan, Azure SQL with the free offer, monitoring with low caps and alerts, and the
// two identities (the API's, and the deploy pipeline's for GitHub OIDC).

@allowed([
  'dev'
  'prod'
])
param environmentName string
param location string
param locationShort string
param staticWebAppLocation string
param tags object
param alertEmail string
param monthlyBudgetUsd int
param budgetStartDate string
param entraTenantId string
param entraApiClientId string
param githubRepository string
param customDomain string
param customDomainDnsReady bool
param logDailyCapGb string
param functionExecutionsPerDayAlert int
param lockDatabase bool

@description('The custom role that reads the Static Web App deployment token (main.bicep).')
param tokenReaderRoleId string

var suffix = 'stride-${environmentName}-${locationShort}'
var databaseName = 'sqldb-${suffix}'
var customDomainLive = !empty(customDomain) && customDomainDnsReady
var customDomainOrigins = empty(customDomain) ? [] : [
  'https://${customDomain}'
]
var webOrigins = concat([
  'https://${web.properties.defaultHostname}'
], customDomainOrigins)

// --- Web --------------------------------------------------------------------------------------

resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'stapp-stride-${environmentName}-weu'
  location: staticWebAppLocation
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// Phase two of the custom domain: deploy with customDomainDnsReady once the CNAME exists,
// otherwise validation fails.
resource webDomain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (customDomainLive) {
  parent: web
  name: customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

// --- Identities -------------------------------------------------------------------------------

// The API signs in to Azure SQL as this identity. User-assigned, so that its client id is known
// here and the migrations can create its database user from that id (docs/decisions.md, D85).
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${suffix}-api'
  location: location
  tags: tags
}

// The deploy pipeline, trusted for the repository's GitHub environment of the same name.
resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${suffix}-deploy'
  location: location
  tags: tags
}

resource github 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-${environmentName}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:${environmentName}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

// --- API --------------------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'ststride${environmentName}${locationShort}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The Consumption plan's run-from-package deployment uses the account key (see the README).
    allowSharedKeyAccess: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    reserved: true
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // CORS is handled by the API itself (ALLOWED_ORIGINS), so that errors and preflights carry
      // the same headers in every environment. Platform CORS stays empty: both would duplicate
      // the Access-Control-Allow-Origin header.
    }
  }
}

resource apiFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: api
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource apiScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: api
  name: 'scm'
  properties: {
    allow: false
  }
}

module apiSettings 'appSettings.bicep' = {
  name: 'func-${suffix}-settings'
  params: {
    siteName: api.name
    // What is on the site now, so that WEBSITE_RUN_FROM_PACKAGE (set by each code deployment)
    // survives a deployment of the infrastructure.
    #disable-next-line use-resource-symbol-reference
    currentSettings: list('${api.id}/config/appsettings', '2023-12-01').properties
    settings: {
      AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
      FUNCTIONS_EXTENSION_VERSION: '~4'
      FUNCTIONS_WORKER_RUNTIME: 'node'
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
      ENVIRONMENT: environmentName
      SQL_SERVER: sqlServer.properties.fullyQualifiedDomainName
      SQL_DATABASE: databaseName
      SQL_AUTH: 'entra'
      SQL_CLIENT_ID: apiIdentity.properties.clientId
      ENTRA_TENANT_ID: entraTenantId
      ENTRA_API_AUDIENCE: entraApiClientId
      ALLOWED_ORIGINS: join(webOrigins, ',')
    }
  }
}

// --- Database ---------------------------------------------------------------------------------

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: 'sql-${suffix}'
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    // Entra-only authentication. The deploy identity is the administrator, so that migrations run
    // in the pipeline; the API's identity gets least-privilege rights from them. The SID of an
    // application or managed identity is its client id.
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      login: deployIdentity.name
      sid: deployIdentity.properties.clientId
      tenantId: tenant().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

// The Consumption plan has no fixed outbound addresses, so Azure services are allowed. A known
// and accepted risk for the MVP (see the README).
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    // The free offer: a monthly allowance of compute and 32 GB, then a pause until the next month.
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    minCapacity: json('0.5')
    autoPauseDelay: 60
    maxSizeBytes: 34359738368
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

resource databaseLock 'Microsoft.Authorization/locks@2020-05-01' = if (lockDatabase) {
  name: 'lock-${databaseName}'
  scope: database
  properties: {
    level: 'CanNotDelete'
    notes: 'Holds every organisation\'s Stride data. Remove this lock on purpose before deleting.'
  }
}

// --- Monitoring -------------------------------------------------------------------------------

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json(logDailyCapGb)
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    IngestionMode: 'LogAnalytics'
    RetentionInDays: 30
  }
}

resource appInsightsCap 'Microsoft.Insights/components/pricingPlans@2017-10-01' = {
  parent: appInsights
  name: 'current'
  properties: {
    planType: 'Basic'
    cap: json(logDailyCapGb)
    warningThreshold: 90
    stopSendNotificationWhenHitCap: false
    stopSendNotificationWhenHitThreshold: false
  }
}

// Everything emails the founder through one action group.
resource founder 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'stride${environmentName}'
    enabled: true
    emailReceivers: [
      {
        name: 'founder'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

var budgetNotification = {
  enabled: true
  operator: 'GreaterThanOrEqualTo'
  thresholdType: 'Actual'
  contactEmails: [
    alertEmail
  ]
  contactGroups: [
    founder.id
  ]
}

resource budget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'budget-${suffix}'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual50: union(budgetNotification, {
        threshold: 50
      })
      actual80: union(budgetNotification, {
        threshold: 80
      })
      actual100: union(budgetNotification, {
        threshold: 100
      })
    }
  }
}

var metricAlerts = [
  {
    name: '5xx'
    description: 'The API answered with server errors.'
    scope: api.id
    namespace: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: 5
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
  }
  {
    name: 'function-failures'
    description: 'Function invocations are failing.'
    scope: appInsights.id
    namespace: 'microsoft.insights/components'
    metric: 'requests/failed'
    aggregation: 'Count'
    operator: 'GreaterThan'
    threshold: 5
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
  }
  {
    name: 'executions'
    description: 'Daily executions are approaching the free monthly grant.'
    scope: api.id
    namespace: 'Microsoft.Web/sites'
    metric: 'FunctionExecutionCount'
    aggregation: 'Total'
    operator: 'GreaterThan'
    threshold: functionExecutionsPerDayAlert
    severity: 3
    frequency: 'PT1H'
    window: 'P1D'
  }
  {
    // The free offer grants 100,000 vCore seconds a month. Warn below 20 percent, then choose
    // between pausing until the next month and paid serverless.
    name: 'sql-free-allowance'
    description: 'Less than 20 percent of the free database compute remains this month.'
    scope: database.id
    namespace: 'Microsoft.Sql/servers/databases'
    metric: 'free_amount_remaining'
    aggregation: 'Minimum'
    operator: 'LessThan'
    threshold: 20000
    severity: 2
    frequency: 'PT1H'
    window: 'PT1H'
  }
]

resource alerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for a in metricAlerts: {
    name: 'alert-${suffix}-${a.name}'
    location: 'global'
    tags: tags
    properties: {
      description: a.description
      severity: a.severity
      enabled: true
      scopes: [
        a.scope
      ]
      evaluationFrequency: a.frequency
      windowSize: a.window
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            name: a.name
            criterionType: 'StaticThresholdCriterion'
            metricNamespace: a.namespace
            metricName: a.metric
            timeAggregation: a.aggregation
            operator: a.operator
            threshold: a.threshold
          }
        ]
      }
      actions: [
        {
          actionGroupId: founder.id
        }
      ]
    }
  }
]

// The Log Analytics daily cap was reached: ingestion stops until the next day. There is no
// metric for it, so a daily log query that costs cents a month.
resource logCapAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${suffix}-log-cap'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    description: 'The daily ingestion cap was reached.'
    severity: 3
    enabled: true
    scopes: [
      logs.id
    ]
    evaluationFrequency: 'P1D'
    windowSize: 'P1D'
    criteria: {
      allOf: [
        {
          query: '_LogOperation | where Category == "Ingestion" and Operation has "Data collection stopped"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        founder.id
      ]
    }
  }
}

// --- Pipeline permissions ---------------------------------------------------------------------

// Least privilege: deploy to (and read the settings of) the Function App, and read the Static Web
// App's deployment token. Nothing more.
var websiteContributor = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'de139f84-1756-47ae-9be6-808fbbe84772'
)

resource deployToApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(api.id, deployIdentity.id, websiteContributor)
  scope: api
  properties: {
    roleDefinitionId: websiteContributor
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource readWebToken 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(web.id, deployIdentity.id, tokenReaderRoleId)
  scope: web
  properties: {
    roleDefinitionId: tokenReaderRoleId
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output deployClientId string = deployIdentity.properties.clientId
output functionAppName string = api.name
output staticWebAppName string = web.name
output webHostname string = web.properties.defaultHostname
output webUrl string = customDomainLive ? 'https://${customDomain}' : 'https://${web.properties.defaultHostname}'
output apiUrl string = 'https://${api.properties.defaultHostName}/api'
output sqlServer string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabase string = database.name
output apiIdentityName string = apiIdentity.name
output apiIdentityClientId string = apiIdentity.properties.clientId
output appInsightsConnectionString string = appInsights.properties.ConnectionString
