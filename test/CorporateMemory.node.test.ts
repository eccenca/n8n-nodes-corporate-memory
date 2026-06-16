import { CorporateMemory } from '../nodes/CorporateMemory/CorporateMemory.node';

const credentials = {
	baseUrl: 'http://docker.localhost/',
	clientId: 'cmemc',
	clientSecret: 'secret',
};

describe('CorporateMemory.loadOptions', () => {
	const workflowInfo = [
		{ id: 'wf-a', label: 'WF A', projectId: 'p1', projectLabel: 'Project One' },
		{ id: 'wf-b', label: 'WF B', projectId: 'p1', projectLabel: 'Project One' },
		{ id: 'wf-c', label: 'WF C', projectId: 'p2', projectLabel: 'Project Two' },
	];

	function loadOptionsContext(currentProject?: string) {
		const httpRequestWithAuthentication = jest.fn().mockResolvedValue(workflowInfo);
		return {
			getCredentials: async () => credentials,
			getCurrentNodeParameter: () => currentProject,
			helpers: { httpRequestWithAuthentication },
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
	function execContext(params: Record<string, unknown>, httpRequestWithAuthentication: jest.Mock) {
		return {
			getInputData: () => [{ json: {} }],
			getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
				name in params ? params[name] : fallback,
			getCredentials: async () => credentials,
			getNode: () => ({ name: 'eccenca Corporate Memory' }),
			continueOnFail: () => false,
			helpers: { httpRequestWithAuthentication },
		} as never;
	}

	it('Execute returns a no-result marker on HTTP 204', async () => {
		const http = jest.fn().mockResolvedValue({ statusCode: 204, body: '', headers: {} });
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
				http,
			),
		);

		expect(result[0][0].json).toEqual({ executed: true, hasResult: false });
		expect(http.mock.calls[0][0]).toBe('corporateMemoryOAuth2Api');
		expect(http.mock.calls[0][1].url).toBe(
			'http://docker.localhost/dataintegration/api/workflow/result/p/t',
		);
	});

	it('Execute returns the JSON variable output', async () => {
		const http = jest.fn().mockResolvedValue({ statusCode: 200, body: { hello: 'world' }, headers: {} });
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
				http,
			),
		);

		expect(result[0][0].json).toEqual({ hello: 'world' });
	});

	it('Execute sends the JSON payload with input + output content types', async () => {
		const http = jest.fn().mockResolvedValue({ statusCode: 200, body: { ok: true }, headers: {} });
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
				http,
			),
		);

		const call = http.mock.calls[0][1];
		expect(call.headers['Content-Type']).toBe('application/json');
		expect(call.headers.Accept).toBe('application/xml');
		expect(call.body).toEqual({ a: 1 });
	});

	it('Execute (Async) returns the activity id and uses output:type', async () => {
		const http = jest
			.fn()
			.mockResolvedValue({ activityId: 'ExecuteWorkflowWithPayload', instanceId: 'X1' });
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
				http,
			),
		);

		expect(result[0][0].json).toEqual({
			activityId: 'ExecuteWorkflowWithPayload',
			instanceId: 'X1',
		});
		expect(http.mock.calls[0][1].url).toContain(
			'/api/workflow/executeAsync/p/t?output:type=application%2Fjson',
		);
	});

	it('SPARQL Select emits one item per binding row', async () => {
		const http = jest.fn().mockResolvedValue({
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
				http,
			),
		);

		expect(result[0].map((item) => item.json)).toEqual([
			{ s: 'http://ex/1' },
			{ s: 'http://ex/2' },
		]);
		expect(http.mock.calls[0][1].url).toContain('/dataplatform/proxy/default/sparql?query=');
	});

	it('Query Catalog List emits one item per saved query', async () => {
		const http = jest.fn().mockResolvedValue({
			payload: [{ iri: 'urn:q1', labels: [{ value: 'Q One' }], queryText: 'SELECT 1' }],
		});
		const node = new CorporateMemory();

		const result = await node.execute.call(
			execContext(
				{ resource: 'queryCatalog', operation: 'list', catalogGraph: 'http://x/queries/' },
				http,
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
		const http = jest.fn().mockResolvedValue('class,instances\nA,142\nB,90\n');
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
				http,
			),
		);

		expect(result[0].map((item) => item.json)).toEqual([
			{ class: 'A', instances: '142' },
			{ class: 'B', instances: '90' },
		]);
		const url = http.mock.calls[0][1].url as string;
		expect(url).toContain('/api/queries/reports/perform?queryIri=urn%3Aq1');
		expect(url).toContain('substitutions=');
	});

	it('Run Report can return the raw CSV string', async () => {
		const http = jest.fn().mockResolvedValue('a,b\n1,2\n');
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
				http,
			),
		);

		expect(result[0][0].json).toEqual({ data: 'a,b\n1,2\n' });
	});
});
