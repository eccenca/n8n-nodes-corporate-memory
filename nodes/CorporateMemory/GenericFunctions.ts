import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/** The credential type name; n8n applies its OAuth2 token from this credential. */
export const CREDENTIAL_NAME = 'corporateMemoryOAuth2Api';

/**
 * Node contexts these helpers run in. The helpers are written `this`-based (the
 * idiomatic n8n pattern) and invoked with `.call(this, …)`, so n8n's request
 * helper and credential resolution see the real node context.
 */
export type CmemFunctions = IExecuteFunctions | ILoadOptionsFunctions;

/**
 * Decrypted shape of the Corporate Memory credential, as read by the helpers.
 *
 * Only the fields needed to resolve component base URLs are listed —
 * authentication (the OAuth2 token exchange/refresh) is owned by n8n via the
 * `oAuth2Api`-extending credential, not by this code.
 */
export interface CorporateMemoryCredentials {
	baseUrl: string;
	clientId?: string;
	clientSecret?: string;
	diBaseUrl?: string;
	dpBaseUrl?: string;
}

export type CmemComponent = 'di' | 'dp';

/** Strip trailing slashes (and surrounding whitespace) from a base URL. */
export function normalizeBaseUrl(url: string): string {
	return (url ?? '').trim().replace(/\/+$/, '');
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

export interface CmemRequestOptions {
	qs?: IDataObject;
	body?: unknown;
	headers?: IDataObject;
	parseJson?: boolean;
	returnFullResponse?: boolean;
}

/**
 * Parse a (possibly string) error body into an object. CMEM returns a JSON error
 * body even for requests that asked for CSV, so on failure the body can arrive as
 * an unparsed string that n8n's own error extractor cannot read.
 */
function parseErrorBody(raw: unknown): JsonObject | undefined {
	if (Array.isArray(raw)) {
		return { errors: raw } as unknown as JsonObject;
	}
	if (raw && typeof raw === 'object') {
		return raw as JsonObject;
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text.startsWith('{') || text.startsWith('[')) {
			try {
				const parsed = JSON.parse(text);
				if (Array.isArray(parsed)) return { errors: parsed } as unknown as JsonObject;
				if (parsed && typeof parsed === 'object') return parsed as JsonObject;
			} catch {
				// not JSON — fall through
			}
		}
	}
	return undefined;
}

/**
 * Locate the response body carried by an error thrown from the request helper.
 *
 * n8n wraps the failure in a `NodeApiError` whose `.cause` is the underlying
 * (axios/legacy) error. For the OAuth2 path that underlying error carries the
 * response body on `.error` (and `.response` is stripped of `data`), and its
 * `.message` is formatted as `"<status> - <json body>"`. We therefore look at
 * `.error`/`.response.data`/`.response.body`/`.body`/`.data` on both the error
 * and its `.cause`, and finally fall back to parsing the JSON tail of the message.
 */
function errorResponseBody(error: unknown): unknown {
	const candidates: unknown[] = [];
	const collect = (source: unknown): void => {
		const s = source as
			| {
					response?: { data?: unknown; body?: unknown };
					error?: unknown;
					body?: unknown;
					data?: unknown;
			  }
			| undefined;
		if (!s || typeof s !== 'object') return;
		candidates.push(s.response?.data, s.response?.body, s.error, s.body, s.data);
	};
	collect(error);
	collect((error as { cause?: unknown })?.cause);
	// n8n's NodeApiError stores a parsed object response body on `context.data`.
	collect((error as { context?: unknown })?.context);
	candidates.push((error as { context?: { data?: unknown } })?.context?.data);
	// …and a non-Error thrown value on `.errorResponse`.
	const errorResponse = (error as { errorResponse?: unknown })?.errorResponse;
	collect(errorResponse);
	candidates.push(errorResponse);

	for (const message of [
		(error as { message?: unknown })?.message,
		(error as { cause?: { message?: unknown } })?.cause?.message,
	]) {
		if (typeof message === 'string') {
			const match = message.match(/^\s*\d{3}\s*-\s*([\s\S]+)$/);
			if (match) candidates.push(match[1]);
		}
	}

	return candidates.find((value) => value !== undefined && value !== null && value !== '');
}

/**
 * Extract a human-readable message from a CMEM error body. Handles the
 * RFC-7807 problem+json shape CMEM uses (`title`/`detail`) plus common
 * `message` / `error_description` / `errors[]` variants.
 */
function cmemErrorMessage(body: JsonObject): string | undefined {
	const str = (value: unknown): string | undefined =>
		typeof value === 'string' && value.trim() ? value.trim() : undefined;

	const title = str(body.title);
	const detail =
		str(body.detail) ??
		str(body.message) ??
		str(body.error_description) ??
		str(body.errorMessage) ??
		str(body.error);
	if (detail) return title && title !== detail ? `${title}: ${detail}` : detail;
	if (title) return title;

	const errors = body.errors;
	if (Array.isArray(errors)) {
		const messages = errors
			.map((entry) => str((entry as IDataObject)?.message) ?? str((entry as IDataObject)?.detail) ?? str(entry))
			.filter((message): message is string => Boolean(message));
		if (messages.length) return messages.join('; ');
	}

	// Last resort: surface a compact JSON of the body so the real detail is
	// visible even when CMEM uses an unexpected field name (better than n8n's
	// generic status message).
	try {
		const json = JSON.stringify(body);
		if (json && json !== '{}') return json.length > 400 ? `${json.slice(0, 400)}…` : json;
	} catch {
		// non-serialisable — fall through
	}
	return undefined;
}

/**
 * Build a `NodeApiError` that surfaces CMEM's own error detail. Returns the
 * original error untouched when no readable body can be recovered (e.g. network
 * errors), so n8n's default handling still applies.
 */
function toCmemApiError(this: CmemFunctions, error: unknown): unknown {
	const body = parseErrorBody(errorResponseBody(error));
	if (!body) return error;

	const httpCode =
		(error as { httpCode?: string | number })?.httpCode ??
		(error as { cause?: { response?: { status?: number } } })?.cause?.response?.status ??
		(error as { response?: { status?: number } })?.response?.status;

	return new NodeApiError(this.getNode(), body, {
		message: cmemErrorMessage(body),
		httpCode: httpCode !== undefined ? String(httpCode) : undefined,
	});
}

/**
 * Perform an authenticated request against a CMEM component. Reads the credential
 * for base-URL resolution and delegates authentication to n8n, which obtains and
 * refreshes the OAuth2 bearer token from the `corporateMemoryOAuth2Api` credential.
 *
 * Call with `this` bound to the node context: `cmemApiRequest.call(this, …)`.
 */
export async function cmemApiRequest(
	this: CmemFunctions,
	component: CmemComponent,
	method: IHttpRequestMethods,
	path: string,
	options: CmemRequestOptions = {},
): Promise<unknown> {
	const credentials = (await this.getCredentials(
		CREDENTIAL_NAME,
	)) as unknown as CorporateMemoryCredentials;
	const url = `${resolveComponentBaseUrl(credentials, component)}${path}`;

	const requestOptions: IHttpRequestOptions = {
		method,
		url,
	};
	if (options.headers !== undefined) {
		requestOptions.headers = options.headers;
	}
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

	try {
		return await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			requestOptions,
		);
	} catch (error) {
		// Surface CMEM's own error detail (e.g. the missing report parameters)
		// instead of n8n's generic "Bad request" message.
		throw toCmemApiError.call(this, error);
	}
}

// ---------------------------------------------------------------------------
// v2 helpers: SPARQL result flattening, report substitutions, CSV parsing
// ---------------------------------------------------------------------------

interface SparqlBindingValue {
	type: string;
	value: string;
	datatype?: string;
	'xml:lang'?: string;
}

export interface SparqlSelectResult {
	head?: { vars?: string[] };
	results?: { bindings?: Array<Record<string, SparqlBindingValue>> };
	boolean?: boolean;
}

/**
 * Flatten a SPARQL SELECT/ASK result into n8n items (one per binding row).
 * `simplify` true → `{ var: value }`; false → the full binding object per var.
 * Unbound variables are simply absent from a row (SPARQL JSON omits them).
 */
export function flattenSparqlResult(result: SparqlSelectResult, simplify: boolean): IDataObject[] {
	if (typeof result?.boolean === 'boolean') {
		return [{ boolean: result.boolean }];
	}
	const bindings = result?.results?.bindings ?? [];
	return bindings.map((row) => {
		const item: IDataObject = {};
		for (const [variable, binding] of Object.entries(row)) {
			if (!binding) continue;
			item[variable] = simplify ? binding.value : (binding as unknown as IDataObject);
		}
		return item;
	});
}

export interface SubstitutionPair {
	name: string;
	value: string;
}

/** Build the `substitutions` map for a report from name/value pairs. */
export function buildSubstitutions(pairs: SubstitutionPair[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (const pair of pairs ?? []) {
		if (pair?.name) {
			map[pair.name] = pair.value ?? '';
		}
	}
	return map;
}

/** Parse delimited CSV text (RFC-4180-ish: quotes, embedded commas/newlines). */
export function parseCsv(text: string): IDataObject[] {
	const rows = parseCsvRows(text);
	if (rows.length === 0) {
		return [];
	}
	const header = rows[0];
	return rows.slice(1).map((cols) => {
		const item: IDataObject = {};
		header.forEach((name, index) => {
			item[name] = cols[index] ?? '';
		});
		return item;
	});
}

function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inQuotes) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') {
				i++;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

// ---------------------------------------------------------------------------
// v2 helpers: query catalog graphs (queries can live in several catalog graphs)
// ---------------------------------------------------------------------------

/** SPARQL that finds every graph containing saved SPARQL query resources. */
const GRAPHS_WITH_QUERIES_SPARQL =
	'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ' +
	'SELECT ?graph ?label (COUNT(?qry) AS ?nrQueries) WHERE { GRAPH ?graph { ' +
	'?qry a <https://vocab.eccenca.com/shui/SparqlQuery> . OPTIONAL { ?graph rdfs:label ?label } ' +
	'} } GROUP BY ?graph ?label';

/**
 * List the graphs that contain saved SPARQL queries (the query catalogs), with
 * their label. Mirrors Corporate Memory's own catalog selector, which is driven
 * by the presence of `shui:SparqlQuery` resources rather than the graph type.
 */
export async function listQueryCatalogGraphs(
	this: CmemFunctions,
): Promise<Array<{ iri: string; label: string; count: number }>> {
	const params = new URLSearchParams();
	params.set('query', GRAPHS_WITH_QUERIES_SPARQL);
	const result = (await cmemApiRequest.call(
		this,
		'dp',
		'GET',
		`/proxy/default/sparql?${params.toString()}`,
		{ headers: { Accept: 'application/sparql-results+json' }, parseJson: true },
	)) as SparqlSelectResult;

	return (result?.results?.bindings ?? [])
		.map((row) => ({
			iri: row.graph?.value ?? '',
			label: row.label?.value ?? '',
			count: Number(row.nrQueries?.value ?? 0),
		}))
		.filter((graph) => graph.iri);
}

export interface CatalogQuerySummary {
	iri: string;
	label: string;
	description: string;
	queryText: string;
	queryTypes: string[];
	catalogGraph: string;
}

/**
 * List saved catalog queries. With no `catalogGraph`, lists across every query
 * catalog graph; otherwise restricts to that one.
 */
export async function listCatalogQueries(
	this: CmemFunctions,
	catalogGraph?: string,
): Promise<CatalogQuerySummary[]> {
	const graphs = catalogGraph
		? [catalogGraph]
		: (await listQueryCatalogGraphs.call(this)).map((graph) => graph.iri);

	const queries: CatalogQuerySummary[] = [];
	for (const graph of graphs) {
		const response = (await cmemApiRequest.call(
			this,
			'dp',
			'GET',
			`/api/querycatalog?contextGraph=${encodeURIComponent(graph)}`,
			{ parseJson: true },
		)) as {
			payload?: Array<{
				iri: string;
				labels?: Array<{ value: string }>;
				descriptions?: Array<{ value: string }>;
				queryText?: string;
				queryTypes?: string[];
			}>;
		};
		for (const query of response.payload ?? []) {
			queries.push({
				iri: query.iri,
				label: query.labels?.[0]?.value ?? query.iri,
				description: query.descriptions?.[0]?.value ?? '',
				queryText: query.queryText ?? '',
				queryTypes: query.queryTypes ?? [],
				catalogGraph: graph,
			});
		}
	}
	return queries;
}
