import {
	buildSubstitutions,
	cmemApiRequest,
	flattenSparqlResult,
	listCatalogQueries,
	listQueryCatalogGraphs,
	normalizeBaseUrl,
	parseCsv,
	resolveComponentBaseUrl,
	type CmemFunctions,
	type CorporateMemoryCredentials,
	type SparqlSelectResult,
} from '../nodes/CorporateMemory/GenericFunctions';

const clientCreds: CorporateMemoryCredentials = {
	baseUrl: 'https://cmem.example.com',
	clientId: 'cid',
	clientSecret: 'secret',
};

/**
 * Minimal node-context stub. The helpers are `this`-based and invoked with
 * `.call(this, …)`, so the stub provides `getCredentials` + the n8n request
 * helper, mirroring how the real `IExecuteFunctions` / `ILoadOptionsFunctions`
 * are used.
 */
function makeContext(http: jest.Mock, creds: CorporateMemoryCredentials = clientCreds): CmemFunctions {
	return {
		getCredentials: async () => creds,
		getNode: () => ({ name: 'eccenca Corporate Memory', type: 'corporateMemory', typeVersion: 1 }),
		helpers: { httpRequestWithAuthentication: http },
	} as unknown as CmemFunctions;
}

describe('normalizeBaseUrl', () => {
	it('strips trailing slashes and whitespace', () => {
		expect(normalizeBaseUrl('https://x/')).toBe('https://x');
		expect(normalizeBaseUrl('  https://x///  ')).toBe('https://x');
		expect(normalizeBaseUrl('https://x')).toBe('https://x');
	});
});

describe('resolveComponentBaseUrl', () => {
	it('derives DI and DP base URLs from the base URL', () => {
		expect(resolveComponentBaseUrl(clientCreds, 'di')).toBe(
			'https://cmem.example.com/dataintegration',
		);
		expect(resolveComponentBaseUrl(clientCreds, 'dp')).toBe(
			'https://cmem.example.com/dataplatform',
		);
	});

	it('honours explicit component overrides', () => {
		expect(
			resolveComponentBaseUrl({ ...clientCreds, diBaseUrl: 'https://di.example.com/' }, 'di'),
		).toBe('https://di.example.com');
		expect(
			resolveComponentBaseUrl({ ...clientCreds, dpBaseUrl: 'https://dp.example.com/' }, 'dp'),
		).toBe('https://dp.example.com');
	});
});

describe('cmemApiRequest', () => {
	it('reads the credential, resolves the base URL and delegates auth to n8n', async () => {
		const http = jest.fn().mockResolvedValue({ ok: true });

		const result = await cmemApiRequest.call(
			makeContext(http, { ...clientCreds, baseUrl: 'https://cmem.example.com/' }),
			'di',
			'POST',
			'/api/workflow/result/p/t',
			{ parseJson: true },
		);

		expect(result).toEqual({ ok: true });
		expect(http).toHaveBeenCalledTimes(1);
		const [credentialName, apiCall] = http.mock.calls[0];
		expect(credentialName).toBe('corporateMemoryOAuth2Api');
		expect(apiCall.url).toBe('https://cmem.example.com/dataintegration/api/workflow/result/p/t');
		expect(apiCall.method).toBe('POST');
		expect(apiCall.json).toBe(true);
	});

	it('passes through headers, query string and body when provided', async () => {
		const http = jest.fn().mockResolvedValue('csv');
		await cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/proxy/default/sparql', {
			headers: { Accept: 'text/csv' },
			qs: { graph: 'g' },
		});

		const apiCall = http.mock.calls[0][1];
		expect(apiCall.url).toBe('https://cmem.example.com/dataplatform/proxy/default/sparql');
		expect(apiCall.headers).toEqual({ Accept: 'text/csv' });
		expect(apiCall.qs).toEqual({ graph: 'g' });
	});

	it('surfaces the CMEM error detail from a string (unparsed JSON) body', async () => {
		const http = jest.fn().mockRejectedValue({
			httpCode: '400',
			response: {
				data: JSON.stringify({
					title: 'Bad Request',
					detail: 'The query requires the following parameters: graph, limit',
				}),
			},
		});

		await expect(
			cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/api/queries/reports/perform', {
				parseJson: false,
			}),
		).rejects.toThrow(/requires the following parameters: graph, limit/);
	});

	it('surfaces the detail from an already-parsed object body and a nested cause', async () => {
		const http = jest.fn().mockRejectedValue({
			cause: { response: { status: 400, data: { detail: 'Missing parameter: from' } } },
		});

		await expect(
			cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/api/queries/reports/perform'),
		).rejects.toThrow(/Missing parameter: from/);
	});

	it('surfaces the detail from the OAuth2 legacy error shape (cause.error body)', async () => {
		// Mirrors n8n's OAuth2 path: NodeApiError.cause = axios error with the body
		// on `.error`, `.response` stripped of data, and message "<status> - <json>".
		const http = jest.fn().mockRejectedValue({
			message: 'Bad request - please check your parameters',
			cause: {
				statusCode: 400,
				status: 400,
				error: { title: 'Bad Request', detail: 'Provide values for: graph, limit' },
				response: { status: 400, statusText: 'Bad Request' },
				message: '400 - {"title":"Bad Request","detail":"Provide values for: graph, limit"}',
			},
		});

		await expect(
			cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/api/queries/reports/perform', {
				parseJson: false,
			}),
		).rejects.toThrow(/Provide values for: graph, limit/);
	});

	it('surfaces the detail from a NodeApiError-style context.data body (problem+json)', async () => {
		// CMEM returns application/problem+json; n8n parses it and stows the object
		// on the wrapping NodeApiError's `context.data`.
		const http = jest.fn().mockRejectedValue({
			message: 'Request failed with status code 400',
			description: 'Request failed with status code 400',
			context: {
				data: {
					detail: 'The following query substitutions we not set: search',
					instance: '/dataplatform/api/queries/reports/perform',
					status: 400,
					title: 'Bad Request',
				},
			},
		});

		await expect(
			cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/api/queries/reports/perform', {
				parseJson: false,
			}),
		).rejects.toThrow(/The following query substitutions we not set: search/);
	});

	it('falls back to parsing the JSON tail of a "<status> - <json>" message', async () => {
		const http = jest.fn().mockRejectedValue({
			message: 'Bad request - please check your parameters',
			cause: { message: '400 - {"detail":"required parameter: country"}' },
		});

		await expect(cmemApiRequest.call(makeContext(http), 'dp', 'GET', '/x')).rejects.toThrow(
			/required parameter: country/,
		);
	});

	it('rethrows the original error when no readable body is present', async () => {
		const original = new Error('socket hang up');
		const http = jest.fn().mockRejectedValue(original);

		await expect(cmemApiRequest.call(makeContext(http), 'di', 'GET', '/x')).rejects.toBe(original);
	});
});

describe('flattenSparqlResult', () => {
	const result: SparqlSelectResult = {
		head: { vars: ['s', 'p', 'o'] },
		results: {
			bindings: [
				{
					s: { type: 'uri', value: 'http://ex/s1' },
					p: { type: 'uri', value: 'http://ex/p1' },
					o: { type: 'literal', value: 'hello', 'xml:lang': 'en' },
				},
				{
					s: { type: 'uri', value: 'http://ex/s2' },
					// p unbound for this row
					o: { type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
				},
			],
		},
	};

	it('returns one item per row with simplified values', () => {
		expect(flattenSparqlResult(result, true)).toEqual([
			{ s: 'http://ex/s1', p: 'http://ex/p1', o: 'hello' },
			{ s: 'http://ex/s2', o: '42' },
		]);
	});

	it('returns full binding objects when not simplified', () => {
		const rows = flattenSparqlResult(result, false);
		expect(rows[0].o).toEqual({ type: 'literal', value: 'hello', 'xml:lang': 'en' });
		expect(rows[1]).not.toHaveProperty('p');
	});

	it('handles ASK results', () => {
		expect(flattenSparqlResult({ boolean: true }, true)).toEqual([{ boolean: true }]);
	});
});

describe('buildSubstitutions', () => {
	it('maps name/value pairs and skips entries without a name', () => {
		expect(
			buildSubstitutions([
				{ name: 'graph', value: 'http://ex/g' },
				{ name: '', value: 'ignored' },
				{ name: 'limit', value: '10' },
			]),
		).toEqual({ graph: 'http://ex/g', limit: '10' });
	});
});

describe('parseCsv', () => {
	it('parses a header and rows into objects', () => {
		expect(parseCsv('class,instances\nA,142\nB,90\n')).toEqual([
			{ class: 'A', instances: '142' },
			{ class: 'B', instances: '90' },
		]);
	});

	it('handles quoted fields with commas, newlines and escaped quotes', () => {
		const csv = 'name,note\n"Doe, John","line1\nline2"\n"a ""quote""",ok';
		expect(parseCsv(csv)).toEqual([
			{ name: 'Doe, John', note: 'line1\nline2' },
			{ name: 'a "quote"', note: 'ok' },
		]);
	});

	it('returns an empty array for empty input', () => {
		expect(parseCsv('')).toEqual([]);
	});
});

describe('query catalog graphs', () => {
	it('listQueryCatalogGraphs finds graphs that contain SPARQL query resources', async () => {
		const http = jest.fn().mockResolvedValueOnce({
			head: { vars: ['graph', 'label', 'nrQueries'] },
			results: {
				bindings: [
					{
						graph: { type: 'uri', value: 'g1' },
						label: { type: 'literal', value: 'Catalog One' },
						nrQueries: { type: 'literal', value: '5' },
					},
					{ graph: { type: 'uri', value: 'g2' }, nrQueries: { type: 'literal', value: '19' } },
				],
			},
		});

		const graphs = await listQueryCatalogGraphs.call(makeContext(http));
		expect(graphs).toEqual([
			{ iri: 'g1', label: 'Catalog One', count: 5 },
			{ iri: 'g2', label: '', count: 19 },
		]);
		expect(http.mock.calls[0][1].url).toContain('/proxy/default/sparql?query=');
	});

	it('listCatalogQueries merges across all catalog graphs and tags the source', async () => {
		const http = jest
			.fn()
			.mockResolvedValueOnce({
				results: {
					bindings: [
						{ graph: { type: 'uri', value: 'g1' }, nrQueries: { value: '1' } },
						{ graph: { type: 'uri', value: 'g2' }, nrQueries: { value: '1' } },
					],
				},
			})
			.mockResolvedValueOnce({ payload: [{ iri: 'q1', labels: [{ value: 'Q1' }] }] })
			.mockResolvedValueOnce({ payload: [{ iri: 'q2', labels: [{ value: 'Q2' }] }] });

		const queries = await listCatalogQueries.call(makeContext(http));
		expect(
			queries.map((query) => ({ iri: query.iri, label: query.label, catalogGraph: query.catalogGraph })),
		).toEqual([
			{ iri: 'q1', label: 'Q1', catalogGraph: 'g1' },
			{ iri: 'q2', label: 'Q2', catalogGraph: 'g2' },
		]);
	});
});
