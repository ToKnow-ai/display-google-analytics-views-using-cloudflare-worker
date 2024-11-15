# Using Page Views from Google Analytics to show Page View Count through Couldflare Workers

https://github.com/marketplace/actions/deploy-to-cloudflare-workers-with-wrangler

https://developers.cloudflare.com/workers/configuration/routing/routes/#set-up-a-route-in-wranglertoml
https://developers.cloudflare.com/workers/wrangler/configuration/#sample-wranglertoml-configuration

`npx wrangler deploy --keep-vars`

Below were added via secrets to avoud overriding: https://github.com/cloudflare/workers-sdk/issues/276
```
SERVICE_ACCOUNT_CREDENTIALS = ""
GA_PROPERTY_ID = ""
```