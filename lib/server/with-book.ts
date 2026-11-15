import { findBook, type FoundBook } from "./library";
import { isObject } from "./validate";

export const bookNotFound = () => Response.json({ error: "Book not found." }, { status: 404 });

/** The request's JSON body, or null when it is missing or not JSON; each route says what it expected. */
export const readBody = (request: Request): Promise<unknown> => request.json().catch(() => null);

/** The body when it is a JSON object, or null for anything else. */
export const readObject = async (request: Request): Promise<Record<string, unknown> | null> => {
  const body = await readBody(request);
  return isObject(body) ? body : null;
};

export interface BookRequest<R extends Request> extends FoundBook {
  request: R;
}

type BookContext = { params: Promise<{ bookId: string }> };

/**
 * A route handler for /api/books/[bookId]/..., called only once the book is
 * found. An unknown or invalid id answers `notFound`, by default the JSON 404
 * every book route shares.
 */
export const withBook =
  <R extends Request = Request>(
    handler: (args: BookRequest<R>) => Response | Promise<Response>,
    notFound: () => Response = bookNotFound,
  ) =>
  async (request: R, ctx: BookContext): Promise<Response> => {
    const found = await findBook((await ctx.params).bookId);
    if (!found) return notFound();
    return handler({ ...found, request });
  };
