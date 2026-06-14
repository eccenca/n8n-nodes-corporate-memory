import { CorporateMemory } from '../nodes/CorporateMemory/CorporateMemory.node';
import { clearCmemTokenCache } from '../nodes/CorporateMemory/GenericFunctions';

const credential = {
	data: {
		grantType: 'password',
		baseUrl: 'http://docker.localhost/',
		clientId: 'cmemc',
		username: 'admin',
		password: 'admin',
	},
} as never;

function context(httpRequest: jest.Mock) {
	return { helpers: { httpRequest } } as never;
}

describe('CorporateMemory.credentialTest', () => {
	beforeEach(() => clearCmemTokenCache());

	it('returns OK when the token and userinfo calls succeed', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T', expires_in: 300 }) // token
			.mockResolvedValueOnce({ accountName: 'admin' }); // /userinfo
		const node = new CorporateMemory();

		const result = await node.methods.credentialTest.corporateMemoryApiTest.call(
			context(httpRequest),
			credential,
		);

		expect(result.status).toBe('OK');
		// userinfo is requested against the normalised DataPlatform base URL
		expect(httpRequest.mock.calls[1][0].url).toBe(
			'http://docker.localhost/dataplatform/userinfo',
		);
	});

	it('returns Error when the token request fails', async () => {
		const httpRequest = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
		const node = new CorporateMemory();

		const result = await node.methods.credentialTest.corporateMemoryApiTest.call(
			context(httpRequest),
			credential,
		);

		expect(result.status).toBe('Error');
		expect(result.message).toMatch(/Authentication failed/);
	});
});

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
			getNode: () => ({ name: 'Corporate Memory' }),
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
});
