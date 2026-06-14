import { CorporateMemoryApi } from '../credentials/CorporateMemoryApi.credentials';

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
});
