import type { Emporium, Surface } from '../emporium-client.ts';
import { EXIT, UvdError } from '../errors.ts';
import type { Tool } from '../mcp.ts';
import { renderTable } from '../output.ts';

/**
 * `uvd tools [service]`: without a service, Emporium's own tools. With one, the service is looked
 * up in `emporium_superficies` (never in a list compiled into uvd, so a new surface works without a
 * release) and its own MCP endpoint is listed.
 */
export async function tools(emporium: Emporium, service: string | undefined): Promise<Tool[]> {
  if (service === undefined) return emporium.listTools(emporium.mcpUrl);
  const surface = resolveSurface(await emporium.surfaces(), service);
  // Only a surface that declares it needs nothing is contacted; a missing `auth` is not "none".
  const auth = surface.auth?.tipo;
  if (auth !== 'none') {
    throw new UvdError(
      'credential_required',
      `${surface.id} needs a credential (auth: ${auth ?? 'not declared'}) even to list its tools. uvd 0.1 has no credentials; authenticated services arrive in a later version. Its direct endpoint is ${surface.url_mcp}`,
      EXIT.refused,
      { service: surface.id, auth: auth ?? null, url_mcp: surface.url_mcp },
    );
  }
  return emporium.listTools(surface.url_mcp);
}

export function resolveSurface(surfaces: Surface[], service: string): Surface {
  const wanted = service.toLowerCase();
  const found = surfaces.find((s) => s.id === service) ?? surfaces.find((s) => s.id.toLowerCase() === wanted);
  if (found) return found;
  const known = surfaces.map((s) => s.id);
  throw new UvdError(
    'unknown_service',
    `unknown service "${service}". Services in Emporium's catalog: ${known.join(', ')}`,
    EXIT.notFound,
    { service, known },
  );
}

export function toolsTable(list: Tool[], width: number): string {
  if (list.length === 0) return '(no tools)\n';
  return `${renderTable(
    [
      { key: 'name', header: 'NAME' },
      { key: 'access', header: 'ACCESS' },
      { key: 'description', header: 'DESCRIPTION', flexible: true },
    ],
    list.map((t) => ({
      name: t.name,
      access: access(t),
      description: (t.title ?? t.description ?? '').split('\n')[0] ?? '',
    })),
    width,
  )}\n`;
}

function access(tool: Tool): string {
  const a = tool.annotations;
  if (!a || a.readOnlyHint === undefined) return '?';
  if (a.readOnlyHint) return 'read-only';
  return a.destructiveHint === false ? 'writes' : 'destructive';
}
