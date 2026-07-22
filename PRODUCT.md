# Product

## Register

product

## Users

Casual players, primarily groups of friends playing together in private rooms, with public/competitive play as a secondary mode. They join a short-code room from a phone or a desktop browser and expect to jump into a light, social game of Monopoly with people they know. The context is a hangout, not a tournament: laughing, trash-talk, and shared reactions matter as much as winning. Sessions are opportunistic (a break, an evening in) and span both mobile (portrait, one-handed, on the go) and desktop (big-screen, lean-back) with equal weight. This is a real-time multiplayer 3D game built on the existing server-authoritative Mockopoly engine (custom rules: Zone Partnerships, rent deals, GO deductions).

## Product Purpose

Turn the existing 2D Phaser Mockopoly into a full-fledged 3D game that looks and feels like a hit casual mobile title (Monopoly GO / Rento family): a bright, low-poly toy-world where the classic board sits at the center of a living isometric city diorama, animated with tiny buildings, trees, cars, and pedestrians. The game logic is unchanged and 100% server-authoritative; this product is a brand-new client render layer whose entire job is to make authoritative game state feel alive, tactile, and joyful. Success = players say "this feels like a real game, not a website," it runs smoothly on phone and desktop, and a table of friends wants to keep playing.

## Brand Personality

Playful, polished, social. Fun comes before seriousness, but every detail is crafted to a high bar. The voice is warm and lively with light humor, never corporate, never sterile. Emotional goals: delight (juicy feedback on every action), belonging (you feel the other players in the room with you), and pride-of-craft (it looks expensive-good despite being cartoon-stylized).

## Anti-references

- **Not a website or dashboard.** No web-app cards, form-like settings panels, or flat admin-UI HUDs. Every surface must read as a game world and game HUD, not a site.
- **Not the old dark-luxury 2D.** Deliberately move away from the current gold-on-black flat "casino" look. This is a new visual identity: bright, daylit, colorful toy-world.
- **Not realistic / skeuomorphic.** No photoreal wood-and-felt board simulation. Stylized low-poly toy-world, not realism.
- **Not gambling / casino.** Avoid slot-machine cues, chip-clink casino tropes, and aggressive-monetization vibes. It's a board game with friends, not a betting product.

## Design Principles

1. **It's a place, not a page.** Every screen is a game world or a game HUD. If a surface starts to look like a web page (cards, forms, document flow), it is wrong. Menus, lobby, and dialogs are staged in-world or as game-native panels.
2. **Server is truth, client is spectacle.** The client never invents or owns game state; it only animates the authoritative snapshots the server broadcasts. Juice and motion make state legible and alive, never speculative.
3. **Friends in the room.** Social presence is a first-class citizen: whose turn it is, reactions/emotes, shared big moments (rent hits, bankruptcies, wins) are staged for the whole table, not buried in efficiency-first UI.
4. **Toy-world charm, real craft.** Stylized and playful, but finished to hit-mobile-title quality. Delight lives in micro-details: token hops, dice tumbles, building pop-ins, ambient city life.
5. **Legible over the noise.** The living diorama is visually busy, so game-critical information (turn, money, available actions, alerts) must always cut through, on any screen size, for any player, including colorblind and reduced-motion users.

## Accessibility & Inclusion

Target WCAG AA. Player identity must never rely on color alone: the 8 token colors need a redundant shape/pattern/label so colorblind players can always tell tokens and ownership apart. Provide a reduced-motion mode (the default experience is animation-heavy: camera moves, token hops, dice physics, ambient city). Guarantee readable text contrast for all HUD/game-critical text layered over the busy 3D diorama (backing plates/scrims as needed). Responsive by design across mobile portrait and desktop.
