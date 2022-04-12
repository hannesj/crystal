import LRU from "@graphile/lru";
import { createHash } from "crypto";
import type { CrystalPrepareOptions } from "graphile-crystal";
import {
  $$data,
  $$setPlanGraph,
  crystalPrint,
  execute as crystalExecute,
  isAsyncIterable,
  stripAnsi,
} from "graphile-crystal";
import type {
  DocumentNode,
  ExecutionArgs,
  ExecutionResult,
  GraphQLSchema,
} from "graphql";
import { execute, GraphQLError, parse, Source, validate } from "graphql";
import type { IncomingMessage, ServerResponse } from "http";

import type { ContextCallback, SchemaResult } from "../interfaces.js";
import type { HandlerResult } from "./interfaces.js";

let lastString: string;
let lastHash: string;
const calculateQueryHash = (queryString: string): string => {
  if (queryString !== lastString) {
    lastString = queryString;
    lastHash = createHash("sha1").update(queryString).digest("base64");
  }
  return lastHash;
};

function makeParseAndValidateFunction(schema: GraphQLSchema) {
  type ParseAndValidateResult =
    | { document: DocumentNode; errors?: undefined }
    | { document?: undefined; errors: readonly GraphQLError[] };
  const parseAndValidationCache = new LRU<string, ParseAndValidateResult>({
    maxLength: 500,
  });
  let lastParseAndValidateQuery: string;
  let lastParseAndValidateResult: ParseAndValidateResult;
  function parseAndValidate(query: string): ParseAndValidateResult {
    if (lastParseAndValidateQuery === query) {
      return lastParseAndValidateResult;
    }
    const hash = query.length > 500 ? calculateQueryHash(query) : query;

    const cached = parseAndValidationCache.get(query);
    if (cached) {
      lastParseAndValidateQuery = query;
      lastParseAndValidateResult = cached;
      return cached;
    }

    const source = new Source(query, "GraphQL HTTP Request");
    let document;
    try {
      document = parse(source);
    } catch (e) {
      const result = {
        errors: [
          new GraphQLError(
            e.message,
            null,
            undefined,
            undefined,
            undefined,
            e,
            undefined,
          ),
        ],
      };
      parseAndValidationCache.set(query, result);
      lastParseAndValidateQuery = query;
      lastParseAndValidateResult = result;
      return result;
    }
    const errors = validate(schema, document);
    const result: ParseAndValidateResult = errors.length
      ? { errors }
      : { document };
    parseAndValidationCache.set(query, result);
    lastParseAndValidateQuery = query;
    lastParseAndValidateResult = result;
    return result;
  }
  return parseAndValidate;
}

export const makeGraphQLHandler = (schemaResult: SchemaResult) => {
  const { schema, config } = schemaResult;
  const parseAndValidate = makeParseAndValidateFunction(schema);
  const prepareOptions: CrystalPrepareOptions = {
    experimentalGraphQLBypass: true,
  };

  return async (
    contextValue: object,
    body: unknown,
  ): Promise<HandlerResult> => {
    // Parse the body
    if (typeof body !== "object" || body == null) {
      throw new Error("Invalid body in request");
    }
    const {
      query,
      variables: variableValues,
      operationName,
    } = body as Record<string, any>;
    if (typeof query !== "string") {
      throw new Error("Invalid query");
    }
    if (typeof operationName !== "string" && operationName != null) {
      throw new Error("Invalid operationName");
    }
    if (variableValues != null && typeof variableValues !== "object") {
      throw new Error("Invalid variables");
    }

    const { errors, document } = parseAndValidate(query);

    if (errors) {
      return { type: "graphql", statusCode: 200, payload: { errors } };
    }

    const args: ExecutionArgs = {
      schema,
      document,
      rootValue: null,
      contextValue,
      variableValues,
      operationName,
    };

    const result = await crystalExecute(args);
    if (isAsyncIterable(result)) {
      throw new Error("We don't yet support async iterables");
    }
    return { type: "graphql", statusCode: 200, payload: result };
  };
};
