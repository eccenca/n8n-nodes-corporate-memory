import type { IDataObject, IHttpRequestMethods, IHttpRequestOptions } from 'n8n-workflow';
import { ApplicationError } from 'n8n-workflow';

/**
 * Decrypted shape of the Corporate Memory credential.
 */
export interface CorporateMemoryCredentials {
	grantType: 'client_credentials' | 'password';
	baseUrl: string;
	clientId: string;
	clientSecret?: string;
	username?: string;
	password?: string;
	tokenUrl?: string;
	diBaseUrl?: string;
	dpBaseUrl?: string;
}

export type CmemComponent = 'di' | 'dp';

/**
 * Minimal structural type satisfied by both `IExecuteFunctions` and the
 * credential-test context: anything that can perform an authenticated-agnostic
 * HTTP request. Keeping it narrow makes the auth helpers unit-testable with a
 * plain mock.
 */
export interface CmemRequester {
	helpers: {
		httpRequest(requestOptions: IHttpRequestOptions): Promise<unknown>;
	};
}

interface TokenCacheEntry {
	token: string;
	expiresAt: number;
}

interface TokenResponse {
	access_token?: string;
	expires_in?: number;
}

/** Refresh a token this many milliseconds before it actually expires. */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

/** Module-level token cache, keyed by grant + client + user + token URL. */
const tokenCache = new Map<string, TokenCacheEntry>();

/** Clear the in-memory token cache. Exposed for tests. */
export function clearCmemTokenCache(): void {
	tokenCache.clear();
}

/** Strip trailing slashes (and surrounding whitespace) from a base URL. */
export function normalizeBaseUrl(url: string): string {
	return (url ?? '').trim().replace(/\/+$/, '');
}

/** Resolve the Keycloak token endpoint, honouring an explicit override. */
export function resolveTokenUrl(credentials: CorporateMemoryCredentials): string {
	const override = (credentials.tokenUrl ?? '').trim();
	if (override) {
		return override;
	}
	return `${normalizeBaseUrl(credentials.baseUrl)}/auth/realms/cmem/protocol/openid-connect/token`;
}

/** Resolve the base URL of a CMEM component, honouring an explicit override. */
export function resolveComponentBaseUrl(
	credentials: CorporateMemoryCredentials,
	component: CmemComponent,
): string {
	const base = normalizeBaseUrl(credentials.baseUrl);
	if (component === 'di') {
		const override = (credentials.diBaseUrl ?? '').trim();
		return normalizeBaseUrl(override || `${base}/dataintegration`);
	}
	const override = (credentials.dpBaseUrl ?? '').trim();
	return normalizeBaseUrl(override || `${base}/dataplatform`);
}

function tokenCacheKey(credentials: CorporateMemoryCredentials, tokenUrl: string): string {
	return [credentials.grantType, credentials.clientId, credentials.username ?? '', tokenUrl].join('|');
}

function buildTokenRequestBody(credentials: CorporateMemoryCredentials): string {
	const form = new URLSearchParams();
	form.append('grant_type', credentials.grantType);
	if (credentials.clientId) {
		form.append('client_id', credentials.clientId);
	}
	if (credentials.clientSecret) {
		form.append('client_secret', credentials.clientSecret);
	}
	if (credentials.grantType === 'password') {
		form.append('username', credentials.username ?? '');
		form.append('password', credentials.password ?? '');
	}
	return form.toString();
}

/**
 * Obtain an OAuth2 access token via the client-credentials or password grant,
 * caching it in memory until shortly before it expires.
 *
 * `nowMs` is injectable so cache/expiry behaviour can be tested deterministically.
 */
export async function getCmemToken(
	requester: CmemRequester,
	credentials: CorporateMemoryCredentials,
	nowMs: number = Date.now(),
): Promise<string> {
	const tokenUrl = resolveTokenUrl(credentials);
	const cacheKey = tokenCacheKey(credentials, tokenUrl);

	const cached = tokenCache.get(cacheKey);
	if (cached && nowMs < cached.expiresAt) {
		return cached.token;
	}

	let raw: unknown = undefined;
	let requestError: unknown;
	try {
		raw = await requester.helpers.httpRequest({
			method: 'POST',
			url: tokenUrl,
			body: buildTokenRequestBody(credentials),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
		});
	} catch (error) {
		requestError = error;
	}
	// Thrown outside the catch clause so the helper can surface a node-agnostic
	// ApplicationError (callers wrap it into a NodeApiError with node context).
	if (requestError !== undefined) {
		const message = requestError instanceof Error ? requestError.message : String(requestError);
		throw new ApplicationError(
			`CMEM authentication failed: could not obtain a token from ${tokenUrl}. Check the client credentials and token URL. (${message})`,
		);
	}

	const response = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TokenResponse;
	const accessToken = response?.access_token;
	if (!accessToken) {
		throw new ApplicationError(
			`CMEM authentication failed: the token response from ${tokenUrl} did not contain an access_token.`,
		);
	}

	const expiresInSeconds = Number(response.expires_in ?? 300);
	const ttlMs = Math.max(0, expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS);
	tokenCache.set(cacheKey, { token: accessToken, expiresAt: nowMs + ttlMs });
	return accessToken;
}

export interface CmemRequestOptions {
	qs?: IDataObject;
	body?: unknown;
	headers?: IDataObject;
	parseJson?: boolean;
	returnFullResponse?: boolean;
}

/**
 * Perform an authenticated request against a CMEM component. Resolves the
 * component base URL, obtains/refreshes the bearer token and attaches it.
 */
export async function cmemApiRequest(
	requester: CmemRequester,
	credentials: CorporateMemoryCredentials,
	component: CmemComponent,
	method: IHttpRequestMethods,
	path: string,
	options: CmemRequestOptions = {},
): Promise<unknown> {
	const token = await getCmemToken(requester, credentials);
	const url = `${resolveComponentBaseUrl(credentials, component)}${path}`;

	const requestOptions: IHttpRequestOptions = {
		method,
		url,
		headers: {
			Authorization: `Bearer ${token}`,
			...(options.headers ?? {}),
		},
	};
	if (options.qs !== undefined) {
		requestOptions.qs = options.qs;
	}
	if (options.body !== undefined) {
		requestOptions.body = options.body as IDataObject;
	}
	if (options.parseJson !== undefined) {
		requestOptions.json = options.parseJson;
	}
	if (options.returnFullResponse !== undefined) {
		requestOptions.returnFullResponse = options.returnFullResponse;
	}

	return requester.helpers.httpRequest(requestOptions);
}
