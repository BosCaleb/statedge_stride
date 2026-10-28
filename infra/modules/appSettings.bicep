// Writes a Function App's settings without dropping the ones set elsewhere. The app settings
// resource replaces the whole collection, which would remove WEBSITE_RUN_FROM_PACKAGE (set by
// each code deployment) and take the API offline until the next deploy.

@description('The Function App.')
param siteName string

@secure()
@description('The settings on the site now.')
param currentSettings object

@secure()
@description('The settings this template owns. They win over current ones of the same name.')
param settings object

resource site 'Microsoft.Web/sites@2023-12-01' existing = {
  name: siteName
}

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: union(currentSettings, settings)
}
