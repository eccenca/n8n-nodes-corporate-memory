import { CorporateMemoryOAuth2Api } from '../credentials/CorporateMemoryOAuth2Api.credentials';

describe('CorporateMemoryOAuth2Api credential', () => {
	const credential = new CorporateMemoryOAuth2Api();

	it('has the expected name and icon', () => {
		expect(credential.name).toBe('corporateMemoryOAuth2Api');
		expect(credential.icon).toBe('file:corporateMemory.svg');
	});

	it("extends n8n's built-in oAuth2Api credential", () => {
		expect(credential.extends).toEqual(['oAuth2Api']);
	});

	it('pins the client-credentials grant', () => {
		const grantType = credential.properties.find((property) => property.name === 'grantType');
		expect(grantType?.type).toBe('hidden');
		expect(grantType?.default).toBe('clientCredentials');
	});

	it('derives the access token URL from the base URL (or the override) and keeps it hidden', () => {
		const accessTokenUrl = credential.properties.find(
			(property) => property.name === 'accessTokenUrl',
		);
		expect(accessTokenUrl?.type).toBe('hidden');
		expect(accessTokenUrl?.default).toContain('$self["tokenUrl"]');
		expect(accessTokenUrl?.default).toContain('/auth/realms/cmem/protocol/openid-connect/token');
	});

	it('exposes an editable, optional OAuth Token URL override', () => {
		const tokenUrl = credential.properties.find((property) => property.name === 'tokenUrl');
		expect(tokenUrl?.type).toBe('string');
		expect(tokenUrl?.displayName).toBe('OAuth Token URL');
		expect(tokenUrl?.default).toBe('');
	});

	it('labels the base URL field "Base URL"', () => {
		const baseUrl = credential.properties.find((property) => property.name === 'baseUrl');
		expect(baseUrl?.displayName).toBe('Base URL');
		expect(baseUrl?.required).toBe(true);
	});

	it('orders custom fields as Base URL, OAuth Token URL, then the component overrides', () => {
		const custom = credential.properties
			.map((property) => property.name)
			.filter((name) => ['baseUrl', 'tokenUrl', 'diBaseUrl', 'dpBaseUrl'].includes(name));
		expect(custom).toEqual(['baseUrl', 'tokenUrl', 'diBaseUrl', 'dpBaseUrl']);
	});

	it('sends the client credentials in the urlencoded token body', () => {
		const authentication = credential.properties.find(
			(property) => property.name === 'authentication',
		);
		expect(authentication?.type).toBe('hidden');
		expect(authentication?.default).toBe('body');
	});

	it('defines the connection fields and drops the password-grant fields', () => {
		const names = credential.properties.map((property) => property.name);
		expect(names).toEqual(
			expect.arrayContaining(['baseUrl', 'clientId', 'clientSecret', 'diBaseUrl', 'dpBaseUrl']),
		);
		expect(names).not.toContain('username');
		expect(names).not.toContain('password');
		expect(names).not.toContain('sessionToken');
	});

	it('declares a credential test against the DataPlatform /userinfo endpoint', () => {
		expect(credential.test.request.url).toBe('/userinfo');
	});
});
