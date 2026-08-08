import { useGameStore } from '../state/gameStore';
import { TOKEN_HEX } from '../constants/theme';
import type { Player } from '../types/GameState';
import {
  Badge, Button, KIT, Money, Plinth, Pod, Takeover, TakeoverCol, TakeoverRule,
} from '../ui/kit';
import type { KitStyle } from '../ui/kit';
import { CAP_LINE, NEUTRAL_TURN, SHELL_BACKDROP, SHELL_STAGE_TAKEOVER, turnVars } from './shellChrome';

/** 1ST, 2ND, 3RD, 4TH — the ordinal is the rank badge on each standings row. */
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/**
 * GAME OVER — the winner, and where everyone else finished.
 *
 * A TAKEOVER, and one of the three surfaces that genuinely earns one: the
 * result is COMPARATIVE (my number against theirs) and the whole screen is the
 * subject. The kit's own rule for takeovers is "two-sided information that the
 * board cannot represent", and a final table is exactly that.
 *
 * WHY THE WINNER GETS A WHOLE COLUMN. A standings list answers "who won" in its
 * first row and then buries it under three more. Splitting the celebration out
 * — plinth, net worth, the winner's colour lighting the surface — means the one
 * fact everyone opened this screen for is legible from arm's length, and the
 * table beside it answers everything else.
 */
export function GameOverScreen() {
  const gameOver = useGameStore((s) => s.gameOver);
  const myId = useGameStore((s) => s.myPlayerId);
  const reset = useGameStore((s) => s.reset);

  // App mounts this screen only for `screen === 'game-over'` and unmounts it on
  // reset, so there is no exit to animate and nothing to keep mounted for.
  if (!gameOver) return null;

  const winner = gameOver.finalStandings.find((p) => p.id === gameOver.winnerId);
  const iWon = winner?.id === myId;
  const standings = [...gameOver.finalStandings].sort((a, b) =>
    a.isBankrupt !== b.isBankrupt ? (a.isBankrupt ? 1 : -1) : b.money - a.money,
  );

  // The winner's colour lights the surface. This IS a turn cue in the sense the
  // kit means it — one player owns the moment — so `--turn` is the right
  // variable, and all three of its forms are re-derived (the root's
  // `color-mix()` derivations resolve against the root value, not this one).
  const lit = winner ? turnVars(TOKEN_HEX[winner.token]) : NEUTRAL_TURN;

  return (
    <div style={{ ...SHELL_STAGE_TAKEOVER, ...lit }}>
      <i style={SHELL_BACKDROP} aria-hidden="true" />

      {/* `open` is a literal — this takeover IS the route. See CharacterSelect. */}
      <Takeover
        open
        eyebrow="Game over"
        title={winner ? (iWon ? 'You win' : `${winner.name} wins`) : 'Game over'}
        label="Final standings"
        footer={<Button variant="gold" sheen label="Back to menu" onClick={reset} />}
      >
        <TakeoverCol>
          <div style={celebrate}>
            <Plinth color={winner ? TOKEN_HEX[winner.token] : KIT.text3} />
            <div style={{ ...CAP_LINE, marginTop: 8 }}>Final net worth</div>
            <Money
              value={winner?.money ?? 0}
              size="hero-lg"
              tone={iWon ? 'gain' : 'gold'}
              digits={4}
            />
          </div>
        </TakeoverCol>

        <TakeoverRule />

        <TakeoverCol top style={tableCol}>
          <div style={{ ...CAP_LINE, paddingLeft: 5 }}>Standings</div>
          {/* <Pod> takes no arbitrary DOM props, so the test hook rides a
              wrapper rather than the row itself. */}
          {standings.map((p: Player, i) => (
            <div key={p.id} data-testid="standing">
              <Pod
                name={p.name}
                color={TOKEN_HEX[p.token]}
                swatch
                glass
                isTurn={p.id === gameOver.winnerId}
                isOut={p.isBankrupt}
                badges={
                  p.isBankrupt
                    ? <Badge tone="out">Bankrupt</Badge>
                    : <Money value={p.money} size="glance" digits={3} tone={p.id === myId ? 'gold' : 'default'} />
                }
                value={<span style={rankLine}>{ORDINAL[i] ?? `${i + 1}th`}{p.id === myId ? ' · you' : ''}</span>}
              />
            </div>
          ))}
        </TakeoverCol>
      </Takeover>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ────────────────────────────────────────────────────────────────────────────

/** Centred in its column. `TakeoverCol` already centres its children with auto
 *  margins, so this only has to centre them against each other. */
const celebrate: KitStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
};

/** `top` on the column: four 40px rows plus a caption is 177 of the body's 233,
 *  and a scroll container that centres its content clips the top of a long one. */
const tableCol: KitStyle = { gap: KIT.sp1 };

const rankLine: KitStyle = {
  font: `600 ${KIT.fsMicro}/${KIT.lhSnug} ${KIT.font}`,
  textTransform: 'uppercase',
  letterSpacing: KIT.lsWider,
  color: KIT.text2,
};
