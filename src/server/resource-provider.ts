const URI_SCHEME_RE = /^[a-z][a-z0-9-]*$/;

export interface ResourceListEntry {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceReadResult {
  contents: Array<{
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  }>;
}

export interface ResourceDefinitionInput {
  uriScheme: string;
  title?: string;
  mimeType?: string;
  /** List all readable resource instances. */
  list: () => Promise<{ resources: ResourceListEntry[] }>;
  /**
   * Read a single resource. `vars` originates from RFC 6570 expansion of
   * `{scheme}://{kind}/{id}`.
   */
  read: (uri: URL, vars: { kind: string; id: string }) => Promise<ResourceReadResult>;
}

export interface ResourceDefinition {
  uriScheme: string;
  uriTemplate: string;
  title?: string;
  mimeType?: string;
  list: () => Promise<{ resources: ResourceListEntry[] }>;
  read: (uri: URL, vars: { kind: string; id: string }) => Promise<ResourceReadResult>;
}

function buildUriPattern(scheme: string): RegExp {
  // Mirror epics.md L545-546 and architecture.md L420.
  // Anchored to the supplied scheme so each resource enforces its own URI namespace.
  return new RegExp(`^${scheme}://[a-z][a-z0-9_-]*/[A-Za-z0-9_.-]+$`);
}

// Defense-in-depth: the spec regex allows `.` in id, which lets `.`, `..`, `...`,
// or `..foo` slip through and reach user-supplied `read()` handlers — a path-traversal
// footgun if the handler maps id onto a filesystem path. Reject these explicitly.
function isTraversalSegment(segment: string): boolean {
  return segment === '.' || segment === '..' || segment.includes('..');
}

function extractKindAndId(uri: string, scheme: string): { kind: string; id: string } | undefined {
  const prefix = `${scheme}://`;
  if (!uri.startsWith(prefix)) return undefined;
  const rest = uri.slice(prefix.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return undefined;
  return { kind: rest.slice(0, slashIdx), id: rest.slice(slashIdx + 1) };
}

function assertSafeSegments(uri: string, scheme: string, context: 'list' | 'read'): void {
  const parts = extractKindAndId(uri, scheme);
  // The regex already enforces shape, so parts is defined here; guard for defense-in-depth.
  if (!parts) return;
  if (isTraversalSegment(parts.kind) || isTraversalSegment(parts.id)) {
    throw new Error(
      `defineResources: ${context}() URI contains traversal-like segment ('.' / '..' / '..*'): '${uri}'`,
    );
  }
}

export function defineResources(def: ResourceDefinitionInput): ResourceDefinition {
  if (typeof def.uriScheme !== 'string' || !URI_SCHEME_RE.test(def.uriScheme)) {
    throw new Error(
      `defineResources: uriScheme must match ${URI_SCHEME_RE.source}. Got: '${def.uriScheme}'`,
    );
  }

  const uriTemplate = `${def.uriScheme}://{kind}/{id}`;
  const uriPattern = buildUriPattern(def.uriScheme);

  const wrappedList = async (): Promise<{ resources: ResourceListEntry[] }> => {
    const result = await def.list();
    for (const entry of result.resources) {
      if (!uriPattern.test(entry.uri)) {
        throw new Error(
          `defineResources: list() returned URI not matching {scheme}://{kind}/{id}: '${entry.uri}'`,
        );
      }
      assertSafeSegments(entry.uri, def.uriScheme, 'list');
    }
    return result;
  };

  const wrappedRead = async (
    uri: URL,
    vars: { kind: string; id: string },
  ): Promise<ResourceReadResult> => {
    if (!uriPattern.test(uri.href)) {
      throw new Error(
        `defineResources: read() called with URI not matching {scheme}://{kind}/{id}: '${uri.href}'`,
      );
    }
    assertSafeSegments(uri.href, def.uriScheme, 'read');
    return def.read(uri, vars);
  };

  return {
    uriScheme: def.uriScheme,
    uriTemplate,
    ...(def.title !== undefined && { title: def.title }),
    ...(def.mimeType !== undefined && { mimeType: def.mimeType }),
    list: wrappedList,
    read: wrappedRead,
  };
}
