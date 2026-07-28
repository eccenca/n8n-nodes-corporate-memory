import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Corporate Memory credential.
 *
 * Extends n8n's built-in `oAuth2Api` and pins the `clientCredentials` grant, so
 * n8n owns the OAuth2 token exchange, caching and refresh. CMEM/Keycloak only
 * accepts a Keycloak-issued bearer JWT; the resource-owner password grant is not
 * supported by `oAuth2Api` and is intentionally not offered here.
 */
export class CorporateMemoryOAuth2Api implements ICredentialType {
	name = 'corporateMemoryOAuth2Api';

	extends = ['oAuth2Api'];

	// Title-cased "Eccenca" (not the lowercase brand spelling) because the n8n
	// package scanner enforces cred-class-field-display-name-miscased with inline
	// ESLint config disabled, so a disable comment here is not honoured.
	displayName = 'Eccenca Corporate Memory OAuth2 API';

	documentationUrl = 'https://documentation.eccenca.com/';

	// Themed icon: the dark variant lifts the brand orange for n8n's dark canvas.
	icon = {
		light: 'file:corporateMemory.svg',
		dark: 'file:corporateMemoryDark.svg',
	} as const;

	properties: INodeProperties[] = [
		// --- Hidden overrides of inherited oAuth2Api fields ---------------------
		// Pin the OAuth2 client-credentials grant; n8n handles token exchange,
		// caching and refresh for every authenticated request.
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'clientCredentials',
		},
		// The token endpoint n8n actually uses. Hidden (so it does not render at
		// the top of the inherited block); derived from the editable `tokenUrl`
		// override when set, otherwise from the Base URL. Trailing slashes on the
		// Base URL are stripped to avoid a double slash.
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default:
				'={{$self["tokenUrl"] || ($self["baseUrl"].replace(/\\/+$/, "") + "/auth/realms/cmem/protocol/openid-connect/token")}}',
		},
		// Keycloak issues a service-account token without an explicit scope.
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},
		// Send client_id/client_secret in the urlencoded token body.
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		// Inherited fields overridden in place (keep their inherited position,
		// i.e. they render before the custom fields below): Client ID, Client
		// Secret.
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
			required: true,
			description: 'OAuth2 client secret of the (confidential) service-account client',
		},
		// --- Custom fields (n8n appends these after all inherited fields) -------
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://cmem.example.com',
			description: 'Base URL of the Corporate Memory deployment',
		},
		{
			// Optional override of the derived token endpoint (see accessTokenUrl).
			displayName: 'OAuth Token URL',
			name: 'tokenUrl',
			type: 'string',
			default: '',
			placeholder: 'https://cmem.example.com/auth/realms/cmem/protocol/openid-connect/token',
			description:
				'Optional override for the Keycloak token endpoint. Leave empty to derive it from the Base URL ({Base URL}/auth/realms/cmem/protocol/openid-connect/token); set it for a non-default realm or host.',
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

	// Credential test: GET the DataPlatform /userinfo endpoint. n8n obtains the
	// OAuth2 token automatically (client-credentials, no redirect) and applies it.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{$credentials.dpBaseUrl || (($credentials.baseUrl.endsWith('/') ? $credentials.baseUrl.slice(0, -1) : $credentials.baseUrl) + '/dataplatform')}}",
			url: '/userinfo',
		},
	};
}
