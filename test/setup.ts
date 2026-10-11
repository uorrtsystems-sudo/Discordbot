const nativeFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
    return nativeFetch(input, init);
  }
  throw new Error(`Blocked network call during tests: ${url}`);
};
