/**
 * Pure (Three.js-free) helpers for classifying a character model's material
 * names into "flesh" (recolorable "Skin") vs everything else. Extracted from
 * CharacterToken.tsx so that (a) they can be unit-tested without importing
 * Three.js, and (b) CharacterToken.tsx exports ONLY its component (keeping React
 * Fast Refresh happy).
 *
 * See CharacterToken.tsx's header for the verified per-model bbox reasoning
 * behind why only "Skin" is flesh and "Face" (the eyes/brows decal) is excluded.
 */

/**
 * Flesh material name fragments (case-insensitive, partial match).
 * Materials whose names contain any of these tokens are the character's actual
 * flesh/body — the TARGET of the "Skin Color" recolor. All other materials
 * (outfit, hair, eyes, facial features, accessories) are untouched.
 *
 * Only "skin" is a flesh token. Across all 52 models the "Skin" material's
 * primitive spans the whole body (head + torso + arms + hands + legs), so a
 * single recolor covers the face flesh AND the hands uniformly.
 */
const SKIN_MATERIAL_TOKENS = ['skin'];

/**
 * Explicit exclude list — any material whose name (case-insensitive, partial)
 * contains ANY of these tokens is NEVER recolored, even if it also matches a
 * flesh token. The exclude wins unconditionally.
 *
 * "face" heads the list: the "Face" material is the drawn eyes/eyebrows/mouth
 * decal (NOT flesh), and recoloring it was the reported bug (blue eyes/brows).
 * Also covers hair & facial hair, eyes & ocular components, other facial
 * features, and accessories that may share naming fragments with the flesh
 * material.
 */
const SKIN_EXCLUDE_TOKENS = [
  // Eyes/eyebrows/mouth decal panel (the "Face" material) — NOT flesh.
  'face',
  // Hair & facial hair
  'hair', 'beard', 'mustache', 'moustache', 'stubble', 'goatee', 'sideburn', 'whisker', 'facial',
  // Eyes & ocular
  'eye', 'brow', 'lash', 'pupil', 'iris', 'sclera', 'lens',
  // Other facial features / accessories
  'teeth', 'tooth', 'mouth', 'lip', 'tongue', 'nose', 'ear', 'nail', 'glasses', 'mask',
];

/**
 * Given a list of material names from a cloned scene, return all names that
 * are FLESH materials (the body "Skin"). These are the only materials that get
 * recolored when the player picks a skin color. Outfit, hair, eyes, the "Face"
 * feature decal, and all other accessories are NEVER touched.
 *
 * A material is included when:
 *   1. Its name (case-insensitive) contains "skin"  AND
 *   2. Its name does NOT contain any of the exclude tokens (face, eye, brow,
 *      hair, mouth, …).
 *
 * The exclude check wins — e.g. "FaceSkin" is still excluded (it would be a
 * feature-decal-tone material, not flesh).
 *
 * Returns an empty array when the model has no flesh material (rare).
 */
export function pickSkinMaterialNames(names: string[]): string[] {
  return names.filter((n) => {
    const lower = n.toLowerCase();
    const isSkin = SKIN_MATERIAL_TOKENS.some((token) => lower.includes(token));
    if (!isSkin) return false;
    // Exclude all non-flesh materials: the "Face" feature decal, hair, facial
    // hair, eyes, ocular, other facial features, and accessories — even if they
    // also match a flesh token.
    const isExcluded = SKIN_EXCLUDE_TOKENS.some((token) => lower.includes(token));
    return !isExcluded;
  });
}

/**
 * @deprecated Use pickSkinMaterialNames. Kept for back-compat — delegates to
 * pickSkinMaterialNames and returns the first match or null.
 */
export function pickPrimaryMaterialName(names: string[]): string | null {
  const matches = pickSkinMaterialNames(names);
  return matches.length > 0 ? matches[0] : null;
}
