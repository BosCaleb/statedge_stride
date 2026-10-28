import { z } from 'zod';
import { analysisResultSchema } from '../analysisResult';
import { reportSnapshotSchema } from '../reportSnapshot';
import { analysisSchema, analysisSummarySchema, noteSchema } from './analyses';
import { athleteSchema, consentSchema } from './athletes';
import { problemSchema } from './common';
import { meSchema, organisationSchema } from './org';
import { reportSchema } from './reports';
import { isBinary, routeEntries, type BinaryBody, type RouteDef } from './routes';
import { calibrationSchema, clipSchema, sessionDetailSchema, sessionSchema } from './sessions';

// Builds the OpenAPI 3.1 document from the route registry. scripts/generate-openapi.ts writes it
// to apps/api/openapi.json, and a contract test fails when the committed copy is out of date.
// Request schemas are converted as input (defaults optional, extra keys allowed and dropped) and
// response schemas as output, so a component used on both sides appears twice: `X` and `XInput`.

type JsonSchema = Record<string, unknown>;

/** Resources that get a readable component name. Others are named after their route. */
const NAMED: [string, z.ZodType][] = [
  ['AnalysisResult', analysisResultSchema],
  ['ReportSnapshot', reportSnapshotSchema],
  ['Me', meSchema],
  ['Organisation', organisationSchema],
  ['Athlete', athleteSchema],
  ['Consent', consentSchema],
  ['Session', sessionSchema],
  ['SessionDetail', sessionDetailSchema],
  ['Calibration', calibrationSchema],
  ['Clip', clipSchema],
  ['AnalysisSummary', analysisSummarySchema],
  ['Analysis', analysisSchema],
  ['Note', noteSchema],
  ['Report', reportSchema],
  ['Problem', problemSchema],
];

type Part = 'Params' | 'Query' | 'Body' | 'Response';

function partsOf(route: RouteDef, io: 'input' | 'output'): [Part, z.ZodType][] {
  const candidates: [Part, RouteDef['body'] | RouteDef['response']][] =
    io === 'input'
      ? [
          ['Params', route.params],
          ['Query', route.query],
          ['Body', route.body],
        ]
      : [['Response', route.response]];
  return candidates.flatMap(([part, s]) =>
    s === undefined || s === null || isBinary(s) ? [] : [[part, s] as [Part, z.ZodType]],
  );
}

/** Converts every schema used on one side of the API, with references between them. */
function convert(io: 'input' | 'output') {
  const registry = z.registry<{ id: string }>();
  const suffix = io === 'input' ? 'Input' : '';
  for (const [name, schema] of NAMED) registry.add(schema, { id: name + suffix });
  for (const [name, route] of routeEntries()) {
    for (const [part, schema] of partsOf(route, io)) {
      if (!registry.has(schema)) registry.add(schema, { id: `${name}${part}` });
    }
  }
  const { schemas } = z.toJSONSchema(registry, {
    io,
    unrepresentable: 'throw',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, JsonSchema> };
  for (const s of Object.values(schemas)) {
    delete s.$schema;
    delete s.$id;
  }
  const idOf = (schema: z.ZodType): string => {
    const id = registry.get(schema)?.id;
    if (id === undefined) throw new Error('unregistered schema');
    return id;
  };
  return { schemas, idOf };
}

const binaryContent = (b: BinaryBody) => ({
  [b.contentType]: {
    schema: { type: 'string', contentMediaType: b.contentType, maxLength: b.maxBytes },
  },
});

const ERROR_STATUSES: Record<RouteDef['auth'], number[]> = {
  none: [400, 404, 429, 500],
  token: [400, 401, 403, 404, 409, 413, 422, 429, 500],
  coach: [400, 401, 403, 404, 409, 413, 422, 429, 500],
  admin: [400, 401, 403, 404, 409, 413, 422, 429, 500],
};

const STATUS_TITLES: Record<number, string> = {
  400: 'Validation failed',
  401: 'Missing or invalid token',
  403: 'Not enrolled, or not allowed',
  404: 'Not found in this organisation',
  409: 'Immutable resource written again with different content',
  413: 'Body over the limit',
  422: 'Consent, gate or seat rule not met',
  429: 'Too many requests',
  500: 'Unexpected error',
};

/** The component ids referenced from the paths, directly or through other components. */
function reachable(paths: unknown, components: Record<string, JsonSchema>): Set<string> {
  const found = new Set<string>(['Problem']);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        const id =
          key === '$ref' && typeof inner === 'string'
            ? /^#\/components\/schemas\/(.+)$/.exec(inner)?.[1]
            : undefined;
        if (id !== undefined && !found.has(id)) {
          found.add(id);
          visit(components[id]);
        } else {
          visit(inner);
        }
      }
    }
  };
  visit(paths);
  visit(components.Problem);
  return found;
}

/** The API's major version, as in the /v1 path prefix. */
const API_VERSION = '1';

export function buildOpenApiDocument() {
  const input = convert('input');
  const output = convert('output');
  const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

  // Parameters are listed per operation, so their object schemas do not become components.
  const parameterComponents = new Set<string>();
  const parameters = (route: RouteDef) =>
    (
      [
        ['path', route.params],
        ['query', route.query],
      ] as const
    ).flatMap(([where, schema]) => {
      if (!schema) return [];
      const id = input.idOf(schema);
      parameterComponents.add(id);
      const json = input.schemas[id] ?? {};
      const required = new Set((json.required ?? []) as string[]);
      return Object.entries((json.properties ?? {}) as Record<string, JsonSchema>).map(
        ([name, property]) => ({
          name,
          in: where,
          required: where === 'path' || required.has(name),
          schema: property,
        }),
      );
    });

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, route] of routeEntries()) {
    const success = route.response === null ? 204 : route.creates ? 201 : 200;
    const reply = route.response;
    const content =
      reply === null
        ? undefined
        : isBinary(reply)
          ? binaryContent(reply)
          : { 'application/json': { schema: ref(output.idOf(reply)) } };
    const responses: Record<string, unknown> = {
      [String(success)]: {
        description: route.creates ? 'Created' : 'OK',
        ...(content ? { content } : {}),
      },
    };
    if (route.creates === 'once') {
      responses['200'] = {
        description: 'The same request was repeated',
        ...(content ? { content } : {}),
      };
    }
    for (const status of ERROR_STATUSES[route.auth]) {
      responses[String(status)] = { $ref: `#/components/responses/Problem${status}` };
    }
    const request = route.body;
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: name,
      summary: route.summary,
      'x-stride-auth': route.auth,
      security: route.auth === 'none' ? [] : [{ entra: [] }],
      parameters: parameters(route),
      ...(request
        ? {
            requestBody: {
              required: true,
              content: isBinary(request)
                ? binaryContent(request)
                : { 'application/json': { schema: ref(input.idOf(request)) } },
            },
          }
        : {}),
      responses,
    };
  }

  const all: Record<string, JsonSchema> = { ...input.schemas, ...output.schemas };
  for (const id of parameterComponents) delete all[id];
  const schemas = Object.fromEntries(
    [...reachable(paths, all)].sort().map((id) => [id, all[id] as JsonSchema]),
  );
  const responses = Object.fromEntries(
    Object.entries(STATUS_TITLES).map(([status, description]) => [
      `Problem${status}`,
      { description, content: { 'application/problem+json': { schema: ref('Problem') } } },
    ]),
  );
  return {
    openapi: '3.1.0',
    info: {
      title: 'StatEdge Stride API',
      version: API_VERSION,
      description:
        'Errors are RFC 9457 problem details with a stable code. Creates are idempotent PUTs with client-generated UUIDs.',
    },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: { entra: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas,
      responses,
    },
    paths,
  };
}
