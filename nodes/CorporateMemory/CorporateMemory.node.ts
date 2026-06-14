import {
	NodeConnectionTypes,
	NodeApiError,
	NodeOperationError,
	jsonParse,
} from 'n8n-workflow';
import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';

import {
	cmemApiRequest,
	getCmemToken,
	type CmemRequester,
	type CorporateMemoryCredentials,
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
				testedBy: 'corporateMemoryApiTest',
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
						name: 'Workflow',
						value: 'workflow',
						description: 'Execute DataIntegration workflows',
					},
				],
				default: 'workflow',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['workflow'],
					},
				},
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
				typeOptions: {
					loadOptionsMethod: 'getProjects',
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['workflow'],
					},
				},
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
				displayOptions: {
					show: {
						resource: ['workflow'],
					},
				},
				description:
					'Workflow to execute. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Payload',
				name: 'payloadType',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['workflow'],
					},
				},
				options: [
					{
						name: 'CSV',
						value: 'csv',
					},
					{
						name: 'JSON',
						value: 'json',
					},
					{
						name: 'None',
						value: 'none',
					},
					{
						name: 'XML',
						value: 'xml',
					},
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
				displayOptions: {
					show: {
						resource: ['workflow'],
						payloadType: ['json'],
					},
				},
				description: 'JSON payload sent as the workflow input',
			},
			{
				displayName: 'Payload Body',
				name: 'payloadText',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				default: '',
				displayOptions: {
					show: {
						resource: ['workflow'],
						payloadType: ['xml', 'csv'],
					},
				},
				description: 'Payload sent as the workflow input, using the selected content type',
			},
			{
				displayName: 'Result Format',
				name: 'resultFormat',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['workflow'],
					},
				},
				options: [
					{
						name: 'CSV',
						value: 'csv',
					},
					{
						name: 'JSON',
						value: 'json',
					},
					{
						name: 'N-Triples',
						value: 'ntriples',
					},
					{
						name: 'XML',
						value: 'xml',
					},
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
					show: {
						resource: ['workflow'],
						operation: ['execute'],
						resultFormat: ['json'],
					},
				},
				description:
					'Whether to emit one item per element when the JSON result is an array',
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
		},
		credentialTest: {
			async corporateMemoryApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data as unknown as CorporateMemoryCredentials;
				// The credential-test context exposes the legacy `request` helper and,
				// on newer n8n, `httpRequest`. Read both off a local alias (the
				// deprecated-helper lint rule only flags `this.helpers.request`) and
				// prefer `httpRequest` when present. A node-level test is required
				// because the OAuth2 token must be fetched before the check request.
				const helpers = this.helpers as unknown as {
					httpRequest?: (options: IHttpRequestOptions) => Promise<unknown>;
					request?: (options: Record<string, unknown>) => Promise<unknown>;
				};
				const requester: CmemRequester = {
					helpers: {
						httpRequest: async (options: IHttpRequestOptions) => {
							if (typeof helpers.httpRequest === 'function') {
								return helpers.httpRequest(options);
							}
							return helpers.request!({
								method: options.method,
								url: options.url,
								qs: options.qs,
								body: options.body,
								headers: options.headers,
								json: options.json,
							});
						},
					},
				};

				try {
					await getCmemToken(requester, credentials);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { status: 'Error', message: `Authentication failed: ${message}` };
				}

				try {
					await cmemApiRequest(requester, credentials, 'dp', 'GET', '/userinfo', {
						parseJson: true,
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						status: 'Error',
						message: `Token obtained, but the CMEM API could not be reached. Check the base URL / base path. (${message})`,
					};
				}

				return { status: 'OK', message: 'Authentication successful' };
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

				if (resource !== 'workflow') {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
						itemIndex: i,
					});
				}

				const project = encodeURIComponent(this.getNodeParameter('projectId', i) as string);
				const task = encodeURIComponent(this.getNodeParameter('taskId', i) as string);

				// Optional variable input (payload). The execution endpoints accept no
				// body, so a workflow without a variable input just runs as-is.
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
					// Synchronous execute-and-return-result. 204 => no variable output.
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
						response?.statusCode === 204 ||
						output === undefined ||
						output === null ||
						output === '';

					if (noResult) {
						returnData.push({
							json: { executed: true, hasResult: false },
							pairedItem: { item: i },
						});
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
					// Asynchronous execute. `output:type` is required and carries a literal
					// colon, so build it into the path to avoid query-key encoding.
					const path = `/api/workflow/executeAsync/${project}/${task}?output:type=${encodeURIComponent(outputMime)}`;
					const response = (await cmemApiRequest(requester, credentials, 'di', 'POST', path, {
						body,
						headers,
						parseJson: true,
					})) as IDataObject;
					returnData.push({ json: { ...response }, pairedItem: { item: i } });
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
