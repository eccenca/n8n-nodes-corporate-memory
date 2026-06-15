import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	INodeProperties,
} from 'n8n-workflow';

import {
	getCmemToken,
	type CorporateMemoryCredentials,
} from '../nodes/CorporateMemory/GenericFunctions';

export class CorporateMemoryApi implements ICredentialType {
	name = 'corporateMemoryApi';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased -- "eccenca" is an intentionally lowercase brand name
	displayName = 'eccenca Corporate Memory API';

	documentationUrl = 'https://documentation.eccenca.com/';

	icon = 'file:corporateMemory.svg' as const;

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
		{
			// Storage slot for the token fetched by preAuthentication. The
			// `expirable` flag is what makes n8n actually invoke preAuthentication
			// (on first use, on expiry, and during the credential test).
			displayName: 'Session Token',
			name: 'sessionToken',
			type: 'hidden',
			typeOptions: {
				expirable: true,
				password: true,
			},
			default: '',
		},
	];

	// Fetch an OAuth2 access token (client-credentials or password grant) before
	// any authenticated request. The returned `sessionToken` is referenced by
	// `authenticate` and by the credential `test` below.
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const token = await getCmemToken(this, credentials as unknown as CorporateMemoryCredentials);
		return { sessionToken: token };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.sessionToken}}',
			},
		},
	};

	// Credential test: GET the DataPlatform /userinfo endpoint. The base URL is
	// derived from the static credential fields (the test URL is resolved before
	// preAuthentication runs); the bearer token comes from `authenticate`.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{$credentials.dpBaseUrl || (($credentials.baseUrl.endsWith('/') ? $credentials.baseUrl.slice(0, -1) : $credentials.baseUrl) + '/dataplatform')}}",
			url: '/userinfo',
		},
	};
}
