import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class CorporateMemoryApi implements ICredentialType {
	name = 'corporateMemoryApi';

	displayName = 'Corporate Memory API';

	documentationUrl = 'https://documentation.eccenca.com/';

	icon = 'file:corporateMemory.svg' as const;

	// The credential is tested by the Corporate Memory node via `testedBy`
	// (see CorporateMemory.node.ts → methods.credentialTest). A node-level test
	// is required because the OAuth2 token must be fetched before the check call,
	// which a declarative `test` request cannot do in current n8n.
	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'options',
			options: [
				{
					name: 'Client Credentials',
					value: 'client_credentials',
				},
				{
					name: 'Password',
					value: 'password',
				},
			],
			default: 'client_credentials',
			description: 'OAuth2 grant flow used to obtain an access token from Keycloak',
		},
		{
			displayName: 'CMEM Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://cmem.example.com',
			description: 'Base URL of the Corporate Memory deployment',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'OAuth2 client ID (for example the cmemc service account client)',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'OAuth2 client secret. Required for the client credentials grant; optional for the password grant when using a public Keycloak client.',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			displayOptions: {
				show: {
					grantType: ['password'],
				},
			},
			description: 'Username for the resource-owner password grant',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			displayOptions: {
				show: {
					grantType: ['password'],
				},
			},
			description: 'Password for the resource-owner password grant',
		},
		{
			displayName: 'OAuth Token URL',
			name: 'tokenUrl',
			type: 'string',
			default: '',
			placeholder: 'https://cmem.example.com/auth/realms/cmem/protocol/openid-connect/token',
			description:
				'Override the Keycloak token endpoint. Defaults to {Base URL}/auth/realms/cmem/protocol/openid-connect/token.',
		},
		{
			displayName: 'DataIntegration Base URL',
			name: 'diBaseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://cmem.example.com/dataintegration',
			description: 'Override the DataIntegration base URL. Defaults to {Base URL}/dataintegration.',
		},
		{
			displayName: 'DataPlatform Base URL',
			name: 'dpBaseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://cmem.example.com/dataplatform',
			description: 'Override the DataPlatform base URL. Defaults to {Base URL}/dataplatform.',
		},
	];
}
