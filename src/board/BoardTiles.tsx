import { BOARD_SPACES } from '../constants/board';
import { SPACE_POSITIONS, BOARD_WORLD_SIZE, tileToWorld } from './positions';
import { tileColor } from './tileColor';

const TILE = (1 - 2 * 0.134) / 9 * BOARD_WORLD_SIZE * 0.9; // approx regular tile footprint

export function BoardTiles() {
  return (
    <group>
      {/* board base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[BOARD_WORLD_SIZE, BOARD_WORLD_SIZE, 0.1]} />
        <meshStandardMaterial color="#dff0d6" />
      </mesh>
      {BOARD_SPACES.map((space, i) => {
        const [x, , z] = tileToWorld(i);
        return (
          <mesh key={i} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[TILE, TILE]} />
            <meshStandardMaterial color={tileColor(space)} />
          </mesh>
        );
      })}
    </group>
  );
}

// re-export so consumers importing positions via BoardTiles keep working
export { SPACE_POSITIONS };
