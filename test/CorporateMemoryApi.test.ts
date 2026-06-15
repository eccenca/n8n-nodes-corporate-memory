import { CorporateMemoryApi } from '../credentials/CorporateMemoryApi.credentials';
import { clearCmemTokenCache } from '../nodes/CorporateMemory/GenericFunctions';

describe('CorporateMemoryApi credential', () => {
	const credential = new CorporateMemoryApi();

	it('has the expected name and icon', () => {
		expect(credential.name).toBe('corporateMemoryApi');
		expect(credential.icon).toBe('file:corporateMemory.svg');
	});

	it('offers both client-credentials and password grant types', () => {
		const grantType = credential.properties.find((property) => property.name === 'grantType');
		const values = (grantType?.options ?? []).map((option) => (option as { value: string }).value);
		expect(values).toEqual(['client_credentials', 'password']);
	});

	it('defines the connection fields', () => {
		const names = credential.properties.map((property) => property.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'baseUrl',
				'clientId',
				'clientSecret',
				'username',
				'password',
				'tokenUrl',
				'diBaseUrl',
				'dpBaseUrl',
			]),
		);
	});

	it('shows username/password only for the password grant', () => {
		const username = credential.properties.find((property) => property.name === 'username');
		expect(username?.displayOptions?.show?.grantType).toEqual(['password']);
	});

	it('injects the bearer token via authenticate', () => {
		const headers = credential.authenticate.properties.headers as Record<string, string>;
		expect(headers.Authorization).toBe('=Bearer {{$credentials.sessionToken}}');
	});

	it('declares a credential test against the DataPlatform /userinfo endpoint', () => {
		expect(credential.test.request.url).toBe('/userinfo');
	});

	it('preAuthentication fetches a token and returns it as sessionToken', async () => {
		clearCmemTokenCache();
		const httpRequest = jest.fn().mockResolvedValue({ access_token: 'ABC', expires_in: 300 });
		const context = { helpers: { httpRequest } };

		const result = await credential.preAuthentication.call(context as never, {
			grantType: 'client_credentials',
			baseUrl: 'https://cmem.example.com',
			clientId: 'cid',
			clientSecret: 'secret',
		} as never);

		expect(result).toEqual({ sessionToken: 'ABC' });
		expect(httpRequest).toHaveBeenCalledTimes(1);
	});
});
