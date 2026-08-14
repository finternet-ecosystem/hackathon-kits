/**
 * CDIR hackathon org-guard: refuse seed/replay unless GET /hackathon/orgs/self
 * reports isHackathonOrg:true for the caller's API key.
 *
 * Orgs pass when created via portal Enable Hackathon API or organizer
 * POST /hackathon/orgs. Check uses KitApiClient only (no database).
 */
import { KitApiClient, KitApiError } from "./client";

export class NotAHackathonOrgError extends Error {
  constructor(detail: string) {
    super(
      `Refusing to run: this API key's organization is not a CDIR hackathon org (GET /hackathon/orgs/self reported isHackathonOrg:false). ` +
        `Enable Hackathon API in the Developer Portal (or use an organizer-provisioned hackathon key). ${detail}`,
    );
    this.name = "NotAHackathonOrgError";
  }
}

export interface HackathonOrgSelf {
  id: string;
  name: string;
  slug: string;
}

interface OrgSelfResponse {
  orgId: string;
  name: string;
  slug: string;
  isHackathonOrg: boolean;
}

/** Resolves the caller's own org via its API key and refuses to proceed unless it's a hackathon org. */
export async function assertHackathonOrg(client: KitApiClient): Promise<HackathonOrgSelf> {
  let res: OrgSelfResponse;
  try {
    res = await client.get<OrgSelfResponse>("/hackathon/orgs/self");
  } catch (err) {
    if (err instanceof KitApiError && err.status === 401) {
      throw new NotAHackathonOrgError(
        "The provided --api-key was rejected (401). Check it is a valid, unexpired sk_test_ hackathon key.",
      );
    }
    throw err;
  }

  if (!res.isHackathonOrg) {
    throw new NotAHackathonOrgError(
      `Organization ${res.orgId} ("${res.name}") is not marked as a hackathon org. Use Enable Hackathon API in the portal.`,
    );
  }

  return { id: res.orgId, name: res.name, slug: res.slug };
}
