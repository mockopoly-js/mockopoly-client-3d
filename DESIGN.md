<!-- SEED — re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Mockopoly 3D
description: A bright low-poly toy-world Monopoly — the board at the heart of a living, sunny miniature city.
---

# Design System: Mockopoly 3D

## 1. Overview

**Creative North Star: "The Living Toy City"**

Mockopoly 3D is a sunny miniature metropolis you play inside. The classic board sits at the center of a bright, low-poly city diorama that breathes: tiny buildings, trees, cars, and pedestrians live around the edges while the game plays out on the board. Every surface is a toy object rendered with care, not a web page dressed up with rounded corners. The feeling is a hit casual mobile title (Monopoly GO / Rento family) crossed with the crafted calm of a Monument Valley diorama: playful, polished, social.

The system rejects, by name, four things (carried from PRODUCT.md): it is not a website or dashboard (no web-app cards, no form-like settings panels, no flat admin HUD); not the old dark-luxury 2D gold-on-black casino look; not realistic or skeuomorphic wood-and-felt simulation; and not a gambling/casino product. When a surface starts to look like a document or a form, it is wrong, restage it as a game-native panel or an in-world object.

Because the diorama is visually busy, legibility is a first-class constraint, not an afterthought. Game-critical information (whose turn, money, available actions, alerts) always cuts through the scene on any screen size, for colorblind and reduced-motion players alike.

**Key Characteristics:**
- Bright, daylit, colorful, warm. No dark mode.
- Low-poly stylized toy-world with soft shadows and ambient occlusion.
- Chunky, tactile, game-native UI, never flat web cards.
- Choreographed motion and juice on every meaningful action.
- Legible-over-the-noise: critical info always wins against the busy world.

## 2. Colors

A bright afternoon palette: warm daylit neutrals, a signature sunny accent, and controlled candy pops for the world and feedback. Full-palette strategy with deliberate roles, not a rainbow free-for-all.

### Primary
- **Sunny Amber** (anchor ~`oklch(78% 0.15 75)`, hex `[to be resolved during implementation]`): the signature brand color. Primary actions (Roll, Buy, Confirm), coins/money highlights, dice pips, active-turn glow, and celebration bursts. This is the color players associate with the game.

### Secondary
- **Toy-Park Green** (anchor ~`oklch(72% 0.14 145)`, hex `[to be resolved]`): the world's life, GO/positive/"you gained" feedback, healthy/owned states, grass and trees in the diorama.

### Tertiary
- **Sky-Road Teal** (anchor ~`oklch(74% 0.09 210)`, hex `[to be resolved]`): the diorama's roads/water and informational UI (neutral notices, non-urgent panels, links). The cool counterweight to amber.

### Neutral
- **Cream Daylight** (anchor ~`oklch(97% 0.008 85)`, hex `[to be resolved]`): primary UI surface / panel fill. Warm off-white, never `#fff`.
- **Soft Sand** (anchor ~`oklch(90% 0.012 80)`, hex `[to be resolved]`): secondary surfaces, insets, dividers.
- **Warm Slate** (anchor ~`oklch(38% 0.02 80)`, hex `[to be resolved]`): primary text and icons, tinted warm, never `#000`.

### Alert / Feedback (functional)
- **Rent Red** (anchor ~`oklch(62% 0.19 25)`): money loss, rent owed, danger, bankruptcy.
- Reuse **Sunny Amber** for caution/highlight and **Toy-Park Green** for gain/success.

### Named Rules
**The Daylight Rule.** The world is always lit like a bright afternoon. No dark mode, no gloom, no gold-on-black. If a surface reads as dark or "premium casino," it is off-brand.

**The Property-Palette Rule.** The 8 Monopoly color-groups (brown, light-blue, pink, orange, red, yellow, green, dark-blue) are a fixed, inherited data-color system. They are used ONLY for property identity (deed bands, ownership, building tiles), never borrowed for UI chrome. UI chrome speaks amber/green/teal/neutral only.

**The Cut-Through Rule.** Any game-critical text or control layered over the 3D world sits on a solid or lightly-scrimmed toy panel, never floated bare on the diorama. Contrast is measured against the panel, and must meet WCAG AA.

## 3. Typography

**Display Font:** Rounded chunky geometric sans (candidates: Baloo 2 / Fredoka / Nunito family) `[family to be chosen at implementation]`, with `system-ui` fallback.
**Body Font:** Clean rounded humanist sans with a true tabular-figures set `[family to be chosen at implementation]`, with `system-ui` fallback.
**Label/Number treatment:** Body font in tabular-figures mode for all money, dice, prices, and counts.

**Character:** Warm, friendly, and confident, chunky enough to feel like a game and clean enough to stay legible at small mobile sizes over a busy scene. Deliberately NOT the outgoing ITC Kabel Std (elegant-geometric) that carried the dark-luxury 2D identity.

### Hierarchy
- **Display** (weight ~800, `clamp(2rem, 6vw, 3.5rem)`, line-height ~1): game title, win screen, big moment callouts.
- **Headline** (weight ~700, `clamp(1.4rem, 3.5vw, 2rem)`): panel titles, player names, modal headers.
- **Title** (weight ~700, ~1.15rem): section labels, property names, button text.
- **Body** (weight ~500, ~1rem, line-height ~1.5, cap 60–70ch): descriptions, card text, log entries.
- **Label** (weight ~700, ~0.8rem, letter-spacing ~0.04em, uppercase): chips, tags, small stat captions.
- **Money/Number** (body family, tabular figures, weight ~700): all currency, dice, prices, counters.

### Named Rules
**The Coin Rule.** All money, prices, dice, and counters use tabular figures so digits never jitter as values animate. Currency is the most-read text in the game, it must be rock-steady and instantly scannable.

## 4. Elevation

Choreographed, tactile, and soft. This is a toy-world, so depth is real but gentle: soft ambient drop-shadows and ambient occlusion ground objects in the scene, and UI panels read as physical raised toy pieces (stickers, tiles, chunky cards with thickness), never flat rectangles floating on a page. Motion is choreographed: entrances, feedback, and celebrations are orchestrated, easing out on exponential curves (ease-out-quart/quint), never bounce or elastic.

### Shadow Vocabulary (if applicable)
- **World-ground** (`box-shadow: 0 8px 24px -8px rgba(60,45,20,0.35)`): soft contact shadow under 3D objects and raised HUD panels.
- **Lift-hover** (`box-shadow: 0 12px 28px -6px rgba(60,45,20,0.30)`): interactive elements on hover/press-in.

### Named Rules
**The Sticker Rule.** HUD panels are raised toy objects: chunky rounded corners, a hint of thickness/bevel, and a soft contact shadow. They are stuck onto the world, not laid out on a page. A flat 1px-border web card is forbidden.

**The Ease-Out Rule.** All motion decelerates on an exponential ease-out curve. No bounce, no elastic, no linear. Reduced-motion mode replaces choreography with instant/fade transitions.

## 5. Components

`[Omitted in seed — no components built yet. Re-run /impeccable document after Phase 0 scaffold to extract real button/panel/chip/HUD primitives and generate the DESIGN.json sidecar.]`

## 6. Do's and Don'ts

### Do:
- **Do** keep every screen a game world or a game-native HUD. Menus, lobby, and dialogs are staged in-world or as raised toy panels.
- **Do** light everything like a bright afternoon (The Daylight Rule).
- **Do** give money, dice, and counters tabular figures (The Coin Rule).
- **Do** stage social/big moments (rent hits, bankruptcies, wins) for the whole table, not buried in efficiency-first UI.
- **Do** back all critical text with a toy panel/scrim and hit WCAG AA (The Cut-Through Rule).
- **Do** provide colorblind-safe token identity (color + shape/pattern/label) and a reduced-motion mode.

### Don't:
- **Don't** make it look like a website or dashboard: no web-app cards, no form-like settings panels, no flat admin HUD.
- **Don't** revive the old dark-luxury 2D gold-on-black casino look, or use dark mode at all.
- **Don't** go realistic/skeuomorphic: no photoreal wood-and-felt board simulation.
- **Don't** use gambling/casino cues (slot-machine motifs, chip-clink tropes, aggressive-monetization vibes).
- **Don't** borrow the 8 property-group colors for UI chrome (The Property-Palette Rule).
- **Don't** use bounce/elastic/linear motion, or animate CSS layout properties.
- **Don't** float bare text on the busy diorama, or use `#000`/`#fff`, or a colored `border-left` stripe as an accent.
