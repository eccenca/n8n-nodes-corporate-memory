import { CorporateMemory } from '../nodes/CorporateMemory/CorporateMemory.node';
import { clearCmemTokenCache } from '../nodes/CorporateMemory/GenericFunctions';

describe('CorporateMemory.loadOptions', () => {
	beforeEach(() => clearCmemTokenCache());

	const workflowInfo = [
		{ id: 'wf-a', label: 'WF A', projectId: 'p1', projectLabel: 'Project One' },
		{ id: 'wf-b', label: 'WF B', projectId: 'p1', projectLabel: 'Project One' },
		{ id: 'wf-c', label: 'WF C', projectId: 'p2', projectLabel: 'Project Two' },
	];

	function loadOptionsContext(currentProject?: string) {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce(workflowInfo);
		return {
			getCredentials: async () => ({
				grantType: 'password',
				baseUrl: 'http://docker.localhost/',
				clientId: 'cmemc',
				username: 'admin',
				password: 'admin',
			}),
			getCurrentNodeParameter: () => currentProject,
			helpers: { httpRequest },
		} as never;
	}

	it('getProjects de-duplicates projects', async () => {
		const node = new CorporateMemory();
		const options = await node.methods.loadOptions.getProjects.call(loadOptionsContext());
		expect(options).toEqual([
			{ name: 'Project One (p1)', value: 'p1' },
			{ name: 'Project Two (p2)', value: 'p2' },
		]);
	});

	it('getWorkflows filters by the selected project', async () => {
		const node = new CorporateMemory();
		const options = await node.methods.loadOptions.getWorkflows.call(loadOptionsContext('p1'));
		expect(options).toEqual([
			{ name: 'WF A', value: 'wf-a' },
			{ name: 'WF B', value: 'wf-b' },
		]);
	});
});

describe('CorporateMemory.execute', () => {
	beforeEach(() => clearCmemTokenCache());

	function execContext(params: Record<string, unknown>, httpRequest: jest.Mock) {
		return {
			getInputData: () => [{ json: {} }],
			getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
				name in params ? params[name] : fallback,
			getCredentials: async () => ({
				grantType: 'password',
				baseUrl: 'http://docker.localhost/',
				clientId: 'cmemc',
				username: 'admin',
				password: 'admin',
			}),
			getNode: () => ({ name: 'eccenca Corporate Memory' }),
			continueOnFail: () => false,
			helpers: { httpRequest },
		} as never;
	}

	it('Execute returns a no-result marker on HTTP 204', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} });
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'workflow',
					operation: 'execute',
					projectId: 'p',
					taskId: 't',
					payloadType: 'none',
					resultFormat: 'json',
				},
				httpRequest,
			),
		);

		expect(result[0][0].json).toEqual({ executed: true, hasResult: false });
		expect(httpRequest.mock.calls[1][0].url).toBe(
			'http://docker.localhost/dataintegration/api/workflow/result/p/t',
		);
	});

	it('Execute returns the JSON variable output', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({ statusCode: 200, body: { hello: 'world' }, headers: {} });
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'workflow',
					operation: 'execute',
					projectId: 'p',
					taskId: 't',
					payloadType: 'none',
					resultFormat: 'json',
					splitOutput: false,
				},
				httpRequest,
			),
		);

		expect(result[0][0].json).toEqual({ hello: 'world' });
	});

	it('Execute sends the JSON payload with input + output content types', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({ statusCode: 200, body: { ok: true }, headers: {} });
		const node = new CorporateMemory();

		await node.execute.call(
			execContext(
				{
					resource: 'workflow',
					operation: 'execute',
					projectId: 'p',
					taskId: 't',
					payloadType: 'json',
					payloadJson: { a: 1 },
					resultFormat: 'xml',
					splitOutput: false,
				},
				httpRequest,
			),
		);

		const call = httpRequest.mock.calls[1][0];
		expect(call.headers['Content-Type']).toBe('application/json');
		expect(call.headers.Accept).toBe('application/xml');
		expect(call.body).toEqual({ a: 1 });
	});

	it('Execute (Async) returns the activity id and uses output:type', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({ activityId: 'ExecuteWorkflowWithPayload', instanceId: 'X1' });
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'workflow',
					operation: 'executeAsync',
					projectId: 'p',
					taskId: 't',
					payloadType: 'none',
					resultFormat: 'json',
				},
				httpRequest,
			),
		);

		expect(result[0][0].json).toEqual({
			activityId: 'ExecuteWorkflowWithPayload',
			instanceId: 'X1',
		});
		expect(httpRequest.mock.calls[1][0].url).toContain(
			'/api/workflow/executeAsync/p/t?output:type=application%2Fjson',
		);
	});

	it('SPARQL Select emits one item per binding row', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({
				head: { vars: ['s'] },
				results: {
					bindings: [
						{ s: { type: 'uri', value: 'http://ex/1' } },
						{ s: { type: 'uri', value: 'http://ex/2' } },
					],
				},
			});
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'sparql',
					operation: 'select',
					query: 'SELECT ?s WHERE {?s ?p ?o}',
					simplify: true,
					sparqlOptions: {},
				},
				httpRequest,
			),
		);

		expect(result[0].map((item) => item.json)).toEqual([
			{ s: 'http://ex/1' },
			{ s: 'http://ex/2' },
		]);
		expect(httpRequest.mock.calls[1][0].url).toContain(
			'/dataplatform/proxy/default/sparql?query=',
		);
	});

	it('Query Catalog List emits one item per saved query', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce({
				payload: [{ iri: 'urn:q1', labels: [{ value: 'Q One' }], queryText: 'SELECT 1' }],
			});
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{ resource: 'queryCatalog', operation: 'list', catalogGraph: 'http://x/queries/' },
				httpRequest,
			),
		);

		expect(result[0][0].json).toMatchObject({
			iri: 'urn:q1',
			label: 'Q One',
			queryText: 'SELECT 1',
			catalogGraph: 'http://x/queries/',
		});
	});

	it('Run Report sends substitutions and parses CSV into items', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce('class,instances\nA,142\nB,90\n');
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'queryCatalog',
					operation: 'runReport',
					queryIri: 'urn:q1',
					substitutions: { parameter: [{ name: 'graph', value: 'http://ex/g' }] },
					reportOptions: {},
				},
				httpRequest,
			),
		);

		expect(result[0].map((item) => item.json)).toEqual([
			{ class: 'A', instances: '142' },
			{ class: 'B', instances: '90' },
		]);
		const url = httpRequest.mock.calls[1][0].url as string;
		expect(url).toContain('/api/queries/reports/perform?queryIri=urn%3Aq1');
		expect(url).toContain('substitutions=');
	});

	it('Run Report can return the raw CSV string', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 })
			.mockResolvedValueOnce('a,b\n1,2\n');
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{
					resource: 'queryCatalog',
					operation: 'runReport',
					queryIri: 'urn:q1',
					substitutions: {},
					reportOptions: { parseCsv: false },
				},
				httpRequest,
			),
		);

		expect(result[0][0].json).toEqual({ data: 'a,b\n1,2\n' });
	});
});
