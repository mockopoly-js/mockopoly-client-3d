// Camera-framing constants for CameraRig. Kept in their own module so CameraRig
// exports only its component (React Fast Refresh) while these values remain
// importable by tests and any future consumers.
//
// These values were dialed in live via the debug overlay.
//
// INITIAL_CAM_TARGET — fixed orbit target. The camera always loads aimed here
// and stays here unless the user manually pans. NOT tied to any player tile.
//
// INITIAL_CAM_OFFSET — world-space offset from the target. Camera position =
// INITIAL_CAM_TARGET + INITIAL_CAM_OFFSET → [-11.04, 7.64, 0.91]; distance ~10.12.
export const INITIAL_CAM_TARGET: [number, number, number] = [-3.77, 0.61, 0.67];
export const INITIAL_CAM_OFFSET: [number, number, number] = [-7.27, 7.04, 0.24];

// ── Mobile framing ───────────────────────────────────────────────────────────
// On phones (esp. landscape, which is wide-but-short) the board should DOMINATE
// the frame instead of floating in a sea of sky/forest. We keep the desktop view
// ANGLE (elevation) exactly — MOBILE_INITIAL_CAM_OFFSET points along the same ray
// as INITIAL_CAM_OFFSET — but dolly the camera IN to MOBILE_CAM_DIST world units
// from the target. Dollying along the same ray enlarges the board and pushes the
// sky/forest toward the edges (less empty background) without tilting the view.
//
// MOBILE_CAM_DIST is the single live-tune knob: SMALLER = closer = board bigger.
// Desktop distance is ~10.12. Set to 6.9 to keep the full board in frame on mobile
// landscape, where the viewport is wide-but-short and frame-filling. Still along
// the SAME ray (same elevation/angle), so the board stays fully in frame within the
// forest clearing — this only dollies in, it does NOT scale the board mesh (scaling
// would push the board out into the trees). The camera stays FREE: the user can
// still orbit/zoom out; this is just the spawn framing. Only CameraRig consumes
// this, and only when useIsMobile() is true — desktop framing (INITIAL_CAM_OFFSET)
// is completely untouched.
export const MOBILE_CAM_DIST = 6.9;
const _offsetLen = Math.hypot(
  INITIAL_CAM_OFFSET[0],
  INITIAL_CAM_OFFSET[1],
  INITIAL_CAM_OFFSET[2],
);
export const MOBILE_INITIAL_CAM_OFFSET: [number, number, number] = [
  (INITIAL_CAM_OFFSET[0] / _offsetLen) * MOBILE_CAM_DIST,
  (INITIAL_CAM_OFFSET[1] / _offsetLen) * MOBILE_CAM_DIST,
  (INITIAL_CAM_OFFSET[2] / _offsetLen) * MOBILE_CAM_DIST,
];
