import { useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { PURCHASABLE_SPACES } from '../constants/board';
import { tileToWorld } from './positions';

/**
 * Renders an invisible, flat, horizontal clickable plane above each of the 28
 * purchasable board spaces (property / railroad / utility).
 *
 * Each plane sits at y=0.03 (just above the board top face at y=0.02), sized
 * 0.95×0.95 world units — a square that covers the tile footprint for picking.
 *
 * onClick (not onPointerDown) is used so that a pointer-drag (orbit) does NOT
 * trigger the deed card: R3F / @react-three/fiber only fires onClick when the
 * pointer-up lands on the same mesh it went down on without the camera moving
 * more than the drag threshold, matching the behavior users expect.
 *
 * Cursor changes to 'pointer' on hover for affordance and is cleaned up on
 * component unmount.
 */

const PLANE_Y = 0.03;   // just above board top face (0.02)
const TILE_SIZE = 0.95; // square footprint ≈ regular tile width

export function BoardClickTargets() {
  const openDeedCard = useGameStore((s) => s.openDeedCard);

  // Ensure cursor is reset if the component unmounts while hovering
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <>
      {PURCHASABLE_SPACES.map((spaceIndex) => {
        const [wx, , wz] = tileToWorld(spaceIndex);
        return (
          <mesh
            key={spaceIndex}
            position={[wx, PLANE_Y, wz]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              openDeedCard(spaceIndex);
            }}
            onPointerOver={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = '';
            }}
          >
            <planeGeometry args={[TILE_SIZE, TILE_SIZE]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}
