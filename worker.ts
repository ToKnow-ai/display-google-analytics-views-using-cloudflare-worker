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

// New helper function to generate SVG badge
const generateViewsBadge = (views) => {
	const viewsText = views.toLocaleString();
	const textWidth = viewsText.length * 8 + 10; // Approximate width calculation
	const totalWidth = 80 + textWidth;  // Label + padding + views width

	return `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
      <linearGradient id="b" x2="0" y2="100%">
        <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
        <stop offset="1" stop-opacity=".1"/>
      </linearGradient>
      <mask id="a">
        <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
      </mask>
      <g mask="url(#a)">
        <rect width="80" height="20" fill="#555"/>
        <rect x="80" width="${textWidth}" height="20" fill="#4c1"/>
        <rect width="${totalWidth}" height="20" fill="url(#b)"/>
      </g>
      <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
        <text x="40" y="15" fill="#010101" fill-opacity=".3">Page Views</text>
        <text x="40" y="14">Page Views</text>
        <text x="${80 + textWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${viewsText}</text>
        <text x="${80 + textWidth / 2}" y="14">${viewsText}</text>
      </g>
    </svg>`.trim();
}

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

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		try {
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
			const response = await fetch(
				`https://analyticsdata.googleapis.com/v1beta/${env.GA_PROPERTY_ID}:runReport`,
				{
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(requestBody)
				});

			if (!response.ok) {
				return new Response(
					JSON.stringify({ error: await response.text() }, null, 4),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json'
						}
					});
			}

			const data = await response.json();
			const counts = (data?.['rows'] ?? [])
				.flatMap(row => Object.entries(row))
				.filter(([key, _]) => key === 'metricValues')
				.flatMap(([key, values]) => values)
				.map(metricValue => parseInt(metricValue?.['value'] ?? 0))
				.reduce((total, count) => total + count, 0);

			return new Response(
				generateViewsBadge(formatNumber(counts)), {
				headers: {
					'Content-Type': 'image/svg+xml',
					'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
					'Access-Control-Allow-Origin': '*'
				}
			});

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
