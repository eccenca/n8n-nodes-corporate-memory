import {
	NodeConnectionTypes,
	NodeApiError,
	NodeOperationError,
	jsonParse,
} from 'n8n-workflow';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';

import {
	buildSubstitutions,
	cmemApiRequest,
	flattenSparqlResult,
	listCatalogQueries,
	listQueryCatalogGraphs,
	parseCsv,
	type CmemRequester,
	type CorporateMemoryCredentials,
	type SparqlSelectResult,
	type SubstitutionPair,
} from './GenericFunctions';

/** Content types offered for a workflow's variable input (the payload). */
const INPUT_MIME: Record<string, string> = {
	json: 'application/json',
	xml: 'application/xml',
	csv: 'text/csv',
};

/** Content types offered for a workflow's variable output (the result). */
const OUTPUT_MIME: Record<string, string> = {
	json: 'application/json',
	xml: 'application/xml',
	csv: 'text/csv',
	ntriples: 'application/n-triples',
};

function asJsonObject(value: unknown): IDataObject {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}
	return { result: value } as IDataObject;
}

export class CorporateMemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Corporate Memory',
		name: 'corporateMemory',
		icon: 'file:corporateMemory.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with eccenca Corporate Memory (CMEM)',
		usableAsTool: true,
		defaults: {
			name: 'Corporate Memory',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'corporateMemoryApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Query Catalog',
						value: 'queryCatalog',
						description: 'List and run saved (parameterized) queries / reports',
					},
					{
						name: 'SPARQL',
						value: 'sparql',
						description: 'Run SPARQL queries against the knowledge graph',
					},
					{
						name: 'Workflow',
						value: 'workflow',
						description: 'Execute DataIntegration workflows',
					},
				],
				default: 'workflow',
			},

			// ----- Workflow -----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['workflow'] } },
				options: [
					{
						name: 'Execute',
						value: 'execute',
						action: 'Execute a workflow and return its result',
						description:
							'Execute a workflow synchronously, optionally with a payload, and return its variable output',
					},
					{
						name: 'Execute (Async)',
						value: 'executeAsync',
						action: 'Start a workflow execution',
						description: 'Start a workflow execution asynchronously and return the activity ID',
					},
				],
				default: 'execute',
			},
			{
				displayName: 'Project Name or ID',
				name: 'projectId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getProjects' },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['workflow'] } },
				description:
					'DataIntegration project that contains the workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Workflow Name or ID',
				name: 'taskId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getWorkflows',
					loadOptionsDependsOn: ['projectId'],
				},
				default: '',
				required: true,
				displayOptions: { show: { resource: ['workflow'] } },
				description:
					'Workflow to execute. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Payload',
				name: 'payloadType',
				type: 'options',
				displayOptions: { show: { resource: ['workflow'] } },
				options: [
					{ name: 'CSV', value: 'csv' },
					{ name: 'JSON', value: 'json' },
					{ name: 'None', value: 'none' },
					{ name: 'XML', value: 'xml' },
				],
				default: 'none',
				description:
					'Optional payload for the workflow’s variable input. Use None for workflows without a variable input; otherwise pick the content type the variable input expects.',
			},
			{
				displayName: 'JSON Payload',
				name: 'payloadJson',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['workflow'], payloadType: ['json'] } },
				description: 'JSON payload sent as the workflow input',
			},
			{
				displayName: 'Payload Body',
				name: 'payloadText',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				displayOptions: { show: { resource: ['workflow'], payloadType: ['xml', 'csv'] } },
				description: 'Payload sent as the workflow input, using the selected content type',
			},
			{
				displayName: 'Result Format',
				name: 'resultFormat',
				type: 'options',
				displayOptions: { show: { resource: ['workflow'] } },
				options: [
					{ name: 'CSV', value: 'csv' },
					{ name: 'JSON', value: 'json' },
					{ name: 'N-Triples', value: 'ntriples' },
					{ name: 'XML', value: 'xml' },
				],
				default: 'json',
				description:
					'Requested format for the workflow’s variable output. For Execute this sets the Accept header; for Execute (Async) it sets output:type. Workflows without a variable output return no result.',
			},
			{
				displayName: 'Split Output Into Items',
				name: 'splitOutput',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: { resource: ['workflow'], operation: ['execute'], resultFormat: ['json'] },
				},
				description: 'Whether to emit one item per element when the JSON result is an array',
			},

			// ----- SPARQL -----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sparql'] } },
				options: [
					{
						name: 'Select Query',
						value: 'select',
						action: 'Run a SPARQL SELECT query',
						description: 'Run a SPARQL SELECT/ASK query and return one item per result row',
					},
				],
				default: 'select',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				typeOptions: { rows: 8 },
				default: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10',
				required: true,
				displayOptions: { show: { resource: ['sparql'] } },
				description: 'SPARQL SELECT (or ASK) query to run',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['sparql'] } },
				description:
					'Whether to return just the value of each bound variable. Off returns the full binding object (type, value, datatype, language).',
			},
			{
				displayName: 'Options',
				name: 'sparqlOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['sparql'] } },
				options: [
					{
						displayName: 'Default Graph URI',
						name: 'defaultGraphUri',
						type: 'string',
						typeOptions: { multipleValues: true },
						default: [],
						description: 'Zero or more default graph URIs for the query dataset',
					},
					{
						displayName: 'Named Graph URI',
						name: 'namedGraphUri',
						type: 'string',
						typeOptions: { multipleValues: true },
						default: [],
						description: 'Zero or more named graph URIs for the query dataset',
					},
				],
			},

			// ----- Query Catalog -----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['queryCatalog'] } },
				options: [
					{
						name: 'List Queries',
						value: 'list',
						action: 'List catalog queries',
						description: 'List the saved queries in the query catalog',
					},
					{
						name: 'Run Report',
						value: 'runReport',
						action: 'Run a saved query',
						description:
							'Execute a saved query by IRI with parameter substitutions and return the CSV rows',
					},
				],
				default: 'runReport',
			},
			{
				displayName: 'Catalog Graph Name or ID',
				name: 'catalogGraph',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getQueryCatalogs' },
				default: '',
				displayOptions: { show: { resource: ['queryCatalog'] } },
				description:
					'Limit queries to a single catalog graph, or All Catalogs. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Query Name or ID',
				name: 'queryIri',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCatalogQueries', loadOptionsDependsOn: ['catalogGraph'] },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['queryCatalog'], operation: ['runReport'] } },
				description:
					'Saved query to run. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Substitutions',
				name: 'substitutions',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Parameter',
				default: {},
				displayOptions: { show: { resource: ['queryCatalog'], operation: ['runReport'] } },
				description: 'Values for the {{placeholder}} parameters in the saved query',
				options: [
					{
						displayName: 'Parameter',
						name: 'parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								description: 'Placeholder name (without the surrounding braces)',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Value substituted for the placeholder',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'reportOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['queryCatalog'], operation: ['runReport'] } },
				options: [
					{
						displayName: 'Context Graph',
						name: 'contextGraph',
						type: 'string',
						default: '',
						description: 'Narrow execution to a single graph (sets default and named graph)',
					},
					{
						displayName: 'Parse CSV Into Items',
						name: 'parseCsv',
						type: 'boolean',
						default: true,
						description:
							'Whether to parse the CSV result into one item per row. Off returns the raw CSV string.',
					},
					{
						displayName: 'Substitutions (Raw JSON)',
						name: 'substitutionsJson',
						type: 'string',
						default: '',
						description: 'Optional raw JSON object of substitutions, merged over the parameters above',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials(
					'corporateMemoryApi',
				)) as unknown as CorporateMemoryCredentials;
				const requester = this as unknown as CmemRequester;
				const workflows = (await cmemApiRequest(requester, credentials, 'di', 'GET', '/api/workflow/info', {
					parseJson: true,
				})) as Array<{ projectId: string; projectLabel?: string }>;

				const projects = new Map<string, string>();
				for (const workflow of workflows) {
					if (!projects.has(workflow.projectId)) {
						projects.set(workflow.projectId, workflow.projectLabel || workflow.projectId);
					}
				}
				return Array.from(projects, ([value, label]) => ({ name: `${label} (${value})`, value }));
			},
			async getWorkflows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials(
					'corporateMemoryApi',
				)) as unknown as CorporateMemoryCredentials;
				const requester = this as unknown as CmemRequester;
				const selectedProject = this.getCurrentNodeParameter('projectId') as string | undefined;
				const workflows = (await cmemApiRequest(requester, credentials, 'di', 'GET', '/api/workflow/info', {
					parseJson: true,
				})) as Array<{ id: string; label?: string; projectId: string }>;

				return workflows
					.filter((workflow) => !selectedProject || workflow.projectId === selectedProject)
					.map((workflow) => ({ name: workflow.label || workflow.id, value: workflow.id }));
			},
			async getQueryCatalogs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials(
					'corporateMemoryApi',
				)) as unknown as CorporateMemoryCredentials;
				const requester = this as unknown as CmemRequester;
				const catalogs = await listQueryCatalogGraphs(requester, credentials);
				return [
					{ name: 'All Catalogs', value: '' },
					...catalogs.map((catalog) => ({
						name: `${catalog.label || catalog.iri} (${catalog.count})`,
						value: catalog.iri,
					})),
				];
			},
			async getCatalogQueries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = (await this.getCredentials(
					'corporateMemoryApi',
				)) as unknown as CorporateMemoryCredentials;
				const requester = this as unknown as CmemRequester;
				const catalogGraph = (this.getCurrentNodeParameter('catalogGraph') as string) || undefined;
				const queries = await listCatalogQueries(requester, credentials, catalogGraph);
				return queries.map((query) => ({ name: query.label, value: query.iri }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = (await this.getCredentials(
			'corporateMemoryApi',
		)) as unknown as CorporateMemoryCredentials;
		const requester = this as unknown as CmemRequester;

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'workflow') {
					const project = encodeURIComponent(this.getNodeParameter('projectId', i) as string);
					const task = encodeURIComponent(this.getNodeParameter('taskId', i) as string);

					const payloadType = this.getNodeParameter('payloadType', i) as string;
					const headers: IDataObject = {};
					let body: unknown;
					if (payloadType === 'json') {
						const rawPayload = this.getNodeParameter('payloadJson', i) as string | IDataObject;
						body = typeof rawPayload === 'string' ? jsonParse<IDataObject>(rawPayload) : rawPayload;
						headers['Content-Type'] = INPUT_MIME.json;
					} else if (payloadType === 'xml' || payloadType === 'csv') {
						body = this.getNodeParameter('payloadText', i) as string;
						headers['Content-Type'] = INPUT_MIME[payloadType];
					}

					const resultFormat = this.getNodeParameter('resultFormat', i) as string;
					const outputMime = OUTPUT_MIME[resultFormat];

					if (operation === 'execute') {
						headers.Accept = outputMime;
						const response = (await cmemApiRequest(
							requester,
							credentials,
							'di',
							'POST',
							`/api/workflow/result/${project}/${task}`,
							{ body, headers, parseJson: resultFormat === 'json', returnFullResponse: true },
						)) as { body?: unknown; statusCode?: number };

						const output = response?.body;
						const noResult =
							response?.statusCode === 204 || output === undefined || output === null || output === '';

						if (noResult) {
							returnData.push({ json: { executed: true, hasResult: false }, pairedItem: { item: i } });
						} else if (resultFormat === 'json') {
							const splitOutput = this.getNodeParameter('splitOutput', i, false) as boolean;
							if (splitOutput && Array.isArray(output)) {
								for (const element of output) {
									returnData.push({ json: asJsonObject(element), pairedItem: { item: i } });
								}
							} else {
								returnData.push({ json: asJsonObject(output), pairedItem: { item: i } });
							}
						} else {
							returnData.push({
								json: { data: typeof output === 'string' ? output : String(output) },
								pairedItem: { item: i },
							});
						}
					} else {
						const path = `/api/workflow/executeAsync/${project}/${task}?output:type=${encodeURIComponent(outputMime)}`;
						const response = (await cmemApiRequest(requester, credentials, 'di', 'POST', path, {
							body,
							headers,
							parseJson: true,
						})) as IDataObject;
						returnData.push({ json: { ...response }, pairedItem: { item: i } });
					}
				} else if (resource === 'sparql') {
					const query = this.getNodeParameter('query', i) as string;
					const simplify = this.getNodeParameter('simplify', i, true) as boolean;
					const options = this.getNodeParameter('sparqlOptions', i, {}) as {
						defaultGraphUri?: string[];
						namedGraphUri?: string[];
					};

					const params = new URLSearchParams();
					params.set('query', query);
					for (const uri of options.defaultGraphUri ?? []) {
						if (uri) params.append('default-graph-uri', uri);
					}
					for (const uri of options.namedGraphUri ?? []) {
						if (uri) params.append('named-graph-uri', uri);
					}

					const result = (await cmemApiRequest(
						requester,
						credentials,
						'dp',
						'GET',
						`/proxy/default/sparql?${params.toString()}`,
						{ headers: { Accept: 'application/sparql-results+json' }, parseJson: true },
					)) as SparqlSelectResult;

					for (const row of flattenSparqlResult(result, simplify)) {
						returnData.push({ json: row, pairedItem: { item: i } });
					}
				} else if (resource === 'queryCatalog') {
					if (operation === 'list') {
						const catalogGraph =
							(this.getNodeParameter('catalogGraph', i, '') as string) || undefined;
						const queries = await listCatalogQueries(requester, credentials, catalogGraph);
						for (const query of queries) {
							returnData.push({ json: { ...query }, pairedItem: { item: i } });
						}
					} else {
						const queryIri = this.getNodeParameter('queryIri', i) as string;
						const substitutionPairs = this.getNodeParameter('substitutions', i, {}) as {
							parameter?: SubstitutionPair[];
						};
						const reportOptions = this.getNodeParameter('reportOptions', i, {}) as {
							contextGraph?: string;
							parseCsv?: boolean;
							substitutionsJson?: string;
						};

						const substitutions = buildSubstitutions(substitutionPairs.parameter ?? []);
						if (reportOptions.substitutionsJson) {
							Object.assign(
								substitutions,
								jsonParse<Record<string, string>>(reportOptions.substitutionsJson),
							);
						}

						const params = new URLSearchParams();
						params.set('queryIri', queryIri);
						if (Object.keys(substitutions).length > 0) {
							params.set('substitutions', JSON.stringify(substitutions));
						}
						if (reportOptions.contextGraph) {
							params.set('contextGraph', reportOptions.contextGraph);
						}

						const csv = (await cmemApiRequest(
							requester,
							credentials,
							'dp',
							'GET',
							`/api/queries/reports/perform?${params.toString()}`,
							{ headers: { Accept: 'text/csv' }, parseJson: false },
						)) as string;
						const csvText = typeof csv === 'string' ? csv : String(csv);

						if (reportOptions.parseCsv === false) {
							returnData.push({ json: { data: csvText }, pairedItem: { item: i } });
						} else {
							for (const row of parseCsv(csvText)) {
								returnData.push({ json: row, pairedItem: { item: i } });
							}
						}
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
