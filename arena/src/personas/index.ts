import type { Persona } from "./types";
import { compliantShopper } from "./compliant-shopper";
import { limitProber } from "./limit-prober";
import { structurer } from "./structurer";
import { categoryDrifter } from "./category-drifter";
import { nightBurster } from "./night-burster";
import { delegationAbuser } from "./delegation-abuser";
import { colluderRing } from "./colluder-ring";

export const PERSONA_REGISTRY: Record<string, Persona> = {
  "compliant-shopper": compliantShopper,
  "limit-prober": limitProber,
  structurer: structurer,
  "category-drifter": categoryDrifter,
  "night-burster": nightBurster,
  "delegation-abuser": delegationAbuser,
  "colluder-ring": colluderRing,
};

export const PERSONA_IDS = Object.keys(PERSONA_REGISTRY);

export function getPersona(id: string): Persona {
  const p = PERSONA_REGISTRY[id];
  if (!p) throw new Error(`Unknown persona type "${id}". Known personas: ${PERSONA_IDS.join(", ")}`);
  return p;
}

export type { Persona, PersonaAction, PersonaGenContext, PersonaWorld, ActorInfo, MerchantInfo } from "./types";
