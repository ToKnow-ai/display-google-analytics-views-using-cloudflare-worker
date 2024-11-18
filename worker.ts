import GoogleAuth, { GoogleKey } from 'cloudflare-workers-and-google-oauth'

// JSON containing the key for the service account
// download from GCS
export interface Env {
	SERVICE_ACCOUNT_CREDENTIALS: string;
	GA_PROPERTY_ID: string;
}

const getTomorrowDate = () => {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return tomorrow.toISOString().split('T')[0];
}

// Helper function to calculate text width
const getTextWidth = (text: string): number => {
  // Approximate character widths (can be adjusted for more accuracy)
  const averageCharWidth = 8;
  return text.length * averageCharWidth + 10; // Adding padding
};

// Enhanced helper function to generate SVG badge
const generateBadge = (label: string, value: string | number, metadata: string[] = []) => {
  const valueText = typeof value === 'number' ? value.toLocaleString() : value.toString();
  
  // Calculate widths
  const labelWidth = getTextWidth(label);
  const valueWidth = getTextWidth(valueText);
  const totalWidth = labelWidth + valueWidth;

  // Generate metadata comments
  const metadataComments = metadata
    .map(item => `<!-- METADATA: ${item.replace(/-->/g, '—>')} -->`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
	  ${metadataComments}
      <linearGradient id="b" x2="0" y2="100%">
        <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
        <stop offset="1" stop-opacity=".1"/>
      </linearGradient>
      <mask id="a">
        <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
      </mask>
      <g mask="url(#a)">
        <rect width="${labelWidth}" height="20" fill="#555"/>
        <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="#4c1"/>
        <rect width="${totalWidth}" height="20" fill="url(#b)"/>
      </g>
      <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13">
        <text x="${labelWidth/2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
        <text x="${labelWidth/2}" y="14">${label}</text>
        <text x="${labelWidth + valueWidth/2}" y="15" fill="#010101" fill-opacity=".3">${valueText}</text>
        <text x="${labelWidth + valueWidth/2}" y="14">${valueText}</text>
      </g>
    </svg>`.trim();
};

const formatNumber = (num: number) => {
	const isNegative = num < 0;
	const absNum = Math.abs(num);

	if (absNum < 1000) {
		return `${isNegative ? '-' : ''}${Math.trunc(absNum)}`;
	} else if (absNum < 1000000) {
		const formattedNum = absNum / 1000;
		return `${isNegative ? '-' : ''}${formattedNum.toFixed(formattedNum % 1 === 0 ? 0 : 1)}K`;
	} else {
		const formattedNum = absNum / 1000000;
		return `${isNegative ? '-' : ''}${formattedNum.toFixed(formattedNum % 1 === 0 ? 0 : 1)}M`;
	}
}

type Entries<T> = { [K in keyof T]: [K, T[K]]; }[keyof T][];

namespace GoogleAnalyticsReport {
  type MetricType = 'TYPE_INTEGER' | 'TYPE_FLOAT' | 'TYPE_STRING';

  interface DimensionHeader {
    name: string;
  }

  interface MetricHeader {
    name: string;
    type: MetricType;
  }

  export interface DimensionValue {
    value: string;
  }

  export interface MetricValue {
    value: string;
  }

  export interface ReportRow {
    dimensionValues: DimensionValue[];
    metricValues: MetricValue[];
  }

  interface ReportMetadata {
    currencyCode: string;
    timeZone: string;
  }

  export interface Report {
    dimensionHeaders: DimensionHeader[];
    metricHeaders: MetricHeader[];
    rows: ReportRow[];
    rowCount: number;
    metadata: ReportMetadata;
    kind: string;
  }
}

const getValues = (
	analyticsResponse: GoogleAnalyticsReport.Report, 
	dimensionKey: keyof GoogleAnalyticsReport.ReportRow) => {
	return (analyticsResponse?.['rows'] ?? [])
		.flatMap(row => Object.entries(row) as Entries<GoogleAnalyticsReport.ReportRow>)
		.filter(([key, _]) => key ===  dimensionKey)
		.flatMap(([_, values]) => values)
		.map(value => value?.['value'])
}

const IMAGE_CACHE_SECONDS = 45 * 60; // Cache for 45 minutes
const GOOGLE_CALL_CACHE_TTL_SECONDS = 45 * 60; // 45 minutes before revalidating the resource

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		try {
			const cache = caches.default
  			let response = await cache.match(request)
			if (!response) {
				const scopes: string[] = [
					'https://www.googleapis.com/auth/analytics.readonly']
				const googleAuth: GoogleKey = JSON.parse(
					atob(env.SERVICE_ACCOUNT_CREDENTIALS))
				// initialize the service
				const oauth = new GoogleAuth(googleAuth, scopes)
				const token = await oauth.getGoogleAuthToken()

				if (token === undefined) {
					throw new Error("generating Google auth token failed")
				}

				// Only allow GET requests
				if (request.method !== 'GET') {
					return new Response('Method not allowed', { status: 405 });
				}

				const page_path = [
					...new URL(request.url).searchParams.entries()].find(
						([key, _]) => (key || '').toLowerCase().trim() === "page_path")?.[1]
				if (!page_path) {
					return new Response('page_path not available', { status: 405 });
				}
				// Construct the request body
				const requestBody = {
					"dateRanges": [{
						"startDate": "2024-01-01",
						"endDate": getTomorrowDate()
					}],
					"dimensions": [{
						"name": "pagePath"
					}],
					"dimensionFilter": {
						"filter": {
							"fieldName": "pagePath",
							"stringFilter": {
								"matchType": "CONTAINS",
								"value": page_path.toLowerCase().trim()
							}
						}
					},
					"metrics": [{
						"name": "screenPageViews"
					}]
				};

				// Make request to Google Analytics API
				const analyticsResponse = await fetch(
					`https://analyticsdata.googleapis.com/v1beta/${env.GA_PROPERTY_ID}:runReport`,
					{
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${token}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
						'cf': {
							// Always cache this fetch regardless of content type
							// for a max of 45 minutes before revalidating the resource
							cacheTtl: GOOGLE_CALL_CACHE_TTL_SECONDS,
							cacheEverything: true
						},
					});

				if (!analyticsResponse.ok) {
					return new Response(
						JSON.stringify({ error: await analyticsResponse.text() }, null, 4),
						{
							status: 500,
							headers: {
								'Content-Type': 'application/json'
							}
						});
				}

				const data = await analyticsResponse.json<GoogleAnalyticsReport.Report>();
				const counts = getValues(data, 'metricValues')
					.map(value => parseInt(value ?? '0'))
					.reduce((total, count) => total + count, 0);
				const dimensionValues = getValues(data, 'dimensionValues');

				response = new Response(
					generateBadge("readers", formatNumber(counts), dimensionValues), {
					headers: {
						'Content-Type': 'image/svg+xml',
						'Cache-Control': `public, max-age=${IMAGE_CACHE_SECONDS}`,
						'Access-Control-Allow-Origin': '*'
					}
				});

				// Cache API respects Cache-Control headers
				ctx.waitUntil(cache.put(request, response.clone()));
			}
			return response
		} catch (error) {
			return new Response(
				JSON.stringify({
					error: error.message || 'Internal server error',
					timestamp: new Date().toISOString()
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json'
					}
				});
		}
	},
};

