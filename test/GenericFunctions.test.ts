import {
	cmemApiRequest,
	clearCmemTokenCache,
	getCmemToken,
	normalizeBaseUrl,
	resolveComponentBaseUrl,
	resolveTokenUrl,
	type CmemRequester,
	type CorporateMemoryCredentials,
} from '../nodes/CorporateMemory/GenericFunctions';

function makeRequester(httpRequest: jest.Mock): CmemRequester {
	return { helpers: { httpRequest } } as unknown as CmemRequester;
}

const clientCreds: CorporateMemoryCredentials = {
	grantType: 'client_credentials',
	baseUrl: 'https://cmem.example.com',
	clientId: 'cid',
	clientSecret: 'secret',
};

describe('normalizeBaseUrl', () => {
	it('strips trailing slashes and whitespace', () => {
		expect(normalizeBaseUrl('https://x/')).toBe('https://x');
		expect(normalizeBaseUrl('  https://x///  ')).toBe('https://x');
		expect(normalizeBaseUrl('https://x')).toBe('https://x');
	});
});

describe('resolveTokenUrl', () => {
	it('defaults to the Keycloak cmem realm endpoint', () => {
		expect(resolveTokenUrl(clientCreds)).toBe(
			'https://cmem.example.com/auth/realms/cmem/protocol/openid-connect/token',
		);
	});

	it('honours an explicit override', () => {
		expect(resolveTokenUrl({ ...clientCreds, tokenUrl: 'https://kc/realms/x/token' })).toBe(
			'https://kc/realms/x/token',
		);
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

describe('getCmemToken', () => {
	beforeEach(() => clearCmemTokenCache());

	it('fetches a token and caches it within its TTL', async () => {
		const httpRequest = jest.fn().mockResolvedValue({ access_token: 'T1', expires_in: 300 });
		const requester = makeRequester(httpRequest);

		const first = await getCmemToken(requester, clientCreds, 0);
		const second = await getCmemToken(requester, clientCreds, 100_000);

		expect(first).toBe('T1');
		expect(second).toBe('T1');
		expect(httpRequest).toHaveBeenCalledTimes(1);
	});

	it('refreshes the token after it expires (accounting for skew)', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'T1', expires_in: 300 })
			.mockResolvedValueOnce({ access_token: 'T2', expires_in: 300 });
		const requester = makeRequester(httpRequest);

		const first = await getCmemToken(requester, clientCreds, 0);
		const second = await getCmemToken(requester, clientCreds, 300_000);

		expect(first).toBe('T1');
		expect(second).toBe('T2');
		expect(httpRequest).toHaveBeenCalledTimes(2);
	});

	it('sends the client-credentials grant as a urlencoded body', async () => {
		const httpRequest = jest.fn().mockResolvedValue({ access_token: 'T', expires_in: 60 });
		await getCmemToken(makeRequester(httpRequest), clientCreds, 0);

		const options = httpRequest.mock.calls[0][0];
		expect(options.method).toBe('POST');
		expect(options.url).toBe(
			'https://cmem.example.com/auth/realms/cmem/protocol/openid-connect/token',
		);
		expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
		expect(options.body).toContain('grant_type=client_credentials');
		expect(options.body).toContain('client_id=cid');
		expect(options.body).toContain('client_secret=secret');
	});

	it('sends the password grant fields', async () => {
		const httpRequest = jest.fn().mockResolvedValue({ access_token: 'T', expires_in: 60 });
		const passwordCreds: CorporateMemoryCredentials = {
			grantType: 'password',
			baseUrl: 'https://cmem.example.com',
			clientId: 'cid',
			username: 'alice',
			password: 's3cret',
		};

		await getCmemToken(makeRequester(httpRequest), passwordCreds, 0);

		const body = httpRequest.mock.calls[0][0].body as string;
		expect(body).toContain('grant_type=password');
		expect(body).toContain('username=alice');
		expect(body).toContain('password=s3cret');
	});

	it('throws a clear error when the response has no access_token', async () => {
		const httpRequest = jest.fn().mockResolvedValue({ error: 'invalid_client' });
		await expect(getCmemToken(makeRequester(httpRequest), clientCreds, 0)).rejects.toThrow(
			/did not contain an access_token/,
		);
	});

	it('maps an HTTP failure to a friendly authentication error', async () => {
		const httpRequest = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
		await expect(getCmemToken(makeRequester(httpRequest), clientCreds, 0)).rejects.toThrow(
			/CMEM authentication failed/,
		);
	});

	it('caches tokens separately per distinct credential', async () => {
		const httpRequest = jest.fn().mockResolvedValue({ access_token: 'T', expires_in: 300 });
		await getCmemToken(makeRequester(httpRequest), clientCreds, 0);
		await getCmemToken(makeRequester(httpRequest), { ...clientCreds, clientId: 'other' }, 0);
		expect(httpRequest).toHaveBeenCalledTimes(2);
	});
});

describe('cmemApiRequest', () => {
	beforeEach(() => clearCmemTokenCache());

	it('attaches the bearer token and resolves the DI base URL', async () => {
		const httpRequest = jest
			.fn()
			.mockResolvedValueOnce({ access_token: 'TOK', expires_in: 300 })
			.mockResolvedValueOnce({ ok: true });
		const requester = makeRequester(httpRequest);

		const result = await cmemApiRequest(
			requester,
			{ ...clientCreds, baseUrl: 'https://cmem.example.com/' },
			'di',
			'POST',
			'/workflow/workflows/p/t/executeOnPayload',
			{ parseJson: true },
		);

		expect(result).toEqual({ ok: true });
		const apiCall = httpRequest.mock.calls[1][0];
		expect(apiCall.url).toBe(
			'https://cmem.example.com/dataintegration/workflow/workflows/p/t/executeOnPayload',
		);
		expect(apiCall.headers.Authorization).toBe('Bearer TOK');
		expect(apiCall.method).toBe('POST');
	});
});
