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
