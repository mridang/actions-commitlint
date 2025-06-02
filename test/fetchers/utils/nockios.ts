import {
  AxiosHeaders,
  AxiosHeaderValue,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosResponseHeaders,
  HeadersDefaults,
  Method,
  RawAxiosResponseHeaders,
  ResponseType,
} from 'axios';

import {
  RequestInit,
  RequestInfo,
  HeadersInit,
  ResponseInit,
  Response,
} from 'undici';

/**
 * Represents Headers-like objects that can be processed.
 * This includes standard Headers, string arrays, or records.
 */
type HeadersLike =
  | string[][]
  | Record<string, string | undefined | number | boolean | AxiosHeaderValue>
  | Headers
  | HeadersDefaults;

/**
 * Represents URL-like objects or strings.
 */
type UrlLike = string | { href?: string; url?: string };

/**
 * Type for a transformer function that can modify the AxiosRequestConfig
 * before the request is made.
 *
 * @template Init - The type of the `init` object passed to fetch, extending
 * global `RequestInit`.
 * @param config - The Axios request configuration derived from fetch arguments.
 * @param input - The original global `RequestInfo` passed to fetch.
 * @param init - The original global `RequestInit` object passed to fetch.
 * @returns The (potentially modified) AxiosRequestConfig.
 */
type CustomAxiosTransformer<Init extends RequestInit = RequestInit> = (
  config: AxiosRequestConfig,
  input: RequestInfo,
  init?: Init,
) => AxiosRequestConfig;

/**
 * Creates an array of [name, value] header pairs suitable for the Fetch API's
 * Headers constructor, from an Axios-style headers object. This function
 * handles different types of Axios header values, including arrays, and
 * converts all final header values to strings.
 *
 * @param axiosHeadersInput - An Axios headers object, which can be an instance
 * of `AxiosHeaders` (which has a `toJSON()` method) or a plain record.
 * @returns An array of [name, value] string pairs, compatible with
 * `HeadersInit`. Returns an empty array if `axiosHeadersInput` is undefined.
 */
function createFetchHeaders(
  axiosHeadersInput?: RawAxiosResponseHeaders | AxiosResponseHeaders,
): HeadersInit {
  if (!axiosHeadersInput) {
    return [];
  }

  const normalizedHeaders: Record<string, AxiosHeaderValue> =
    typeof (axiosHeadersInput as AxiosHeaders).toJSON === 'function'
      ? (axiosHeadersInput as AxiosHeaders).toJSON()
      : (axiosHeadersInput as Record<string, AxiosHeaderValue>);

  return Object.entries(normalizedHeaders).flatMap(
    ([name, value]): [string, string][] => {
      if (value === null || value === undefined) {
        return [];
      } else if (typeof value === 'string') {
        return [[name, value]];
      } else if (Array.isArray(value)) {
        return value
          .filter((v) => v !== null && v !== undefined)
          .map((v) => [name, String(v)]);
      } else {
        return [[name, String(value)]];
      }
    },
  );
}

/**
 * Checks if the provided headers object is an instance of the global
 * `Headers` class.
 *
 * @param headers - The headers object to check.
 * @returns True if the object is an instance of `Headers`, false otherwise.
 */
const isGlobalHeaders = (headers: HeadersLike): headers is Headers => {
  return typeof Headers !== 'undefined' && headers instanceof Headers;
};

/**
 * Creates an Axios-compatible headers object (Record<string, string>)
 * from various Headers-like input types using a functional approach.
 * It normalizes header names and values to strings. The input `headers` can be
 * a global `Headers` instance, a string[][], or a record-like object which
 * might also be an `AxiosHeaders` instance.
 *
 * @param headersInput - A Headers-like object. Defaults to an empty object.
 * @returns A plain object representing headers with string keys and string
 * values, suitable for an Axios request configuration.
 */
function createAxiosHeaders(
  headersInput: HeadersLike = {},
): Record<string, string> {
  if (isGlobalHeaders(headersInput)) {
    return Object.fromEntries(headersInput.entries());
  } else if (Array.isArray(headersInput)) {
    return Object.fromEntries(
      (headersInput as [unknown, unknown][]).filter(
        (pair): pair is [string, string] =>
          typeof pair[0] === 'string' && typeof pair[1] === 'string',
      ),
    );
  } else {
    let processableRecord: Record<
      string,
      AxiosHeaderValue | string | number | boolean | undefined | null
    >;

    if (typeof (headersInput as AxiosHeaders).toJSON === 'function') {
      processableRecord = (headersInput as AxiosHeaders).toJSON();
    } else {
      processableRecord = headersInput as Record<
        string,
        AxiosHeaderValue | string | number | boolean | undefined | null
      >;
    }

    return Object.entries(processableRecord).reduce<Record<string, string>>(
      (acc, [name, value]) => {
        if (value !== undefined && value !== null) {
          if (typeof value === 'string') {
            acc[name] = value;
          } else if (Array.isArray(value)) {
            acc[name] = value
              .filter((v) => v !== null && v !== undefined)
              .map((v) => String(v))
              .join(', ');
          } else {
            acc[name] = String(value);
          }
        }
        return acc;
      },
      {},
    );
  }
}

/**
 * Extracts a URL string from various URL-like input types.
 *
 * @param input - A URL-like object (supporting `href` or `url` properties) or
 * a string.
 * @returns The URL string, or undefined if it cannot be extracted from the
 * input.
 */
function getUrl(input?: UrlLike): string | undefined {
  if (typeof input === 'string') {
    return input;
  } else if (input?.href) {
    return input.href;
  } else if (input?.url) {
    return input.url;
  }
  return undefined;
}

/**
 * Core function that implements the Fetch WebAPI using an Axios client.
 * It constructs an Axios request from Fetch API arguments, makes the request,
 * and then transforms the Axios response back into a Fetch API `Response`
 * object (using global `Response`).
 *
 * @template Init - The type of the `init` object passed to fetch, extending
 * global `RequestInit`.
 * @param axiosInstance - An instance of Axios, configured as needed.
 * @param transformer - An optional function to transform the
 * `AxiosRequestConfig` before the request is made. Defaults to an identity
 * function.
 * @returns An async function that mimics the `fetch` API signature, taking
 * global `RequestInfo` and an optional global `RequestInit` object,
 * and returning a `Promise<Response>` (global `Response`).
 */
const axiosFetchAdapter =
  <Init extends RequestInit = RequestInit>(
    axiosInstance: AxiosInstance,
    transformer: CustomAxiosTransformer<Init> = (config) => config,
  ) =>
  async (input: RequestInfo, init?: Init): Promise<Response> => {
    const rawHeaders = createAxiosHeaders(init?.headers as HeadersLike);
    const lowerCasedHeaders: Record<string, string> = {};
    Object.entries(rawHeaders).forEach(([name, value]) => {
      lowerCasedHeaders[name.toLowerCase()] = value;
    });

    if (!('content-type' in lowerCasedHeaders)) {
      lowerCasedHeaders['content-type'] = 'text/plain;charset=UTF-8';
    }

    const rawConfig: AxiosRequestConfig = {
      url: getUrl(input as UrlLike),
      method: (init?.method as Method) || 'GET',
      data: init?.body,
      headers: lowerCasedHeaders,
      responseType: 'arraybuffer' as ResponseType,
    };

    const config = transformer(rawConfig, input, init);

    let result: AxiosResponse<ArrayBuffer>;
    try {
      result = await axiosInstance.request<ArrayBuffer>(config);
    } catch (error: unknown) {
      const axiosError = error as {
        response?: AxiosResponse<ArrayBuffer>;
        isAxiosError?: boolean;
      };
      if (axiosError.isAxiosError && axiosError.response) {
        result = axiosError.response;
      } else {
        throw error;
      }
    }

    const responseInit: ResponseInit = {
      status: result.status,
      statusText: result.statusText,
      headers: createFetchHeaders(result.headers),
    };

    return new Response(result.data, responseInit);
  };

/**
 * Builds a Fetch WebAPI-compatible function backed by the provided Axios
 * instance. This allows using Axios's features (interceptors, transformers,
 * etc.) while providing a standard `fetch`-like interface (using global
 * Fetch API types).
 *
 * @template Init - The type of the `init` object passed to fetch, extending
 * global `RequestInit`.
 * @param axiosInstance - An instance of Axios.
 * @param transformer - An optional function to transform the
 * `AxiosRequestConfig` before the request is made.
 * @returns An async function that mimics the `fetch` API:
 * `(input: RequestInfo, init?: Init) => Promise<Response>` (using global
 * types).
 */
export function buildAxiosFetch<Init extends RequestInit = RequestInit>(
  axiosInstance: AxiosInstance,
  transformer?: CustomAxiosTransformer<Init>,
): (input: RequestInfo, init?: Init) => Promise<Response> {
  return axiosFetchAdapter(axiosInstance, transformer);
}
