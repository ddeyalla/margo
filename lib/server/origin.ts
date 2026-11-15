/* The server holds the reader's books, notes and tutor sign-ins and has no login, so it answers only
   this machine. A Host check stops DNS rebinding, where another site's name resolves to 127.0.0.1;
   an Origin check stops another site's page from posting to the API from the reader's browser. */

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

export interface RequestFacts {
  method: string;
  host: string | null;
  origin: string | null;
}

/** Why the request is refused, or null when it may go on. */
export const refusal = ({ method, host, origin }: RequestFacts): string | null => {
  const own = host ? parse(`http://${host}`) : null;
  if (!own || !LOCAL_HOSTNAMES.has(own.hostname)) return "This server only answers 127.0.0.1 and localhost.";
  if (method === "GET" || method === "HEAD" || origin === null) return null;
  return parse(origin)?.host === own.host ? null : "Requests from other sites are not allowed.";
};
