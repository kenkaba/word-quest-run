# WORD QUEST RUN — VISUAL MASTER V1

Status: APPROVED DIRECTION / implementation source of truth

## Product priority
WORD QUEST RUN is visual-first. The player should be overwhelmed by a beautiful, vast fantasy world while playing a simple three-lane English-word runner. Deep lore is secondary to visual wonder, motion, readability, and replay desire.

## Approved hero direction
- Hero: Lumi, approximately high-school age (16–18 impression), cheerful apprentice witch.
- Readable from behind at small mobile size.
- Silver/lavender hair, deep navy witch silhouette, warm antique-gold trim, violet crystal-tipped staff.
- Black cat companion remains a recurring visual companion.
- Avoid childlike/chibi proportions during gameplay. Promotional art may be more expressive, but gameplay silhouette must feel like a teenage fantasy heroine.

### Active art pass
The current `assets/lumi.svg` is the active premium gameplay pass. It keeps the existing rig symbol IDs and replaces the older warm/blonde prototype with the approved silver-lilac / midnight-navy / antique-gold / violet-crystal language. Do not revert it unless the rendered result proves weaker.

## Approved visual target
The approved concept board is the target mood: premium anime-fantasy mobile game, large luminous skies, dramatic atmospheric depth, painterly environment layers, warm gold + midnight/navy UI language, magical particles and cinematic movement.

This board is a DESIGN TARGET, not permission to copy any third-party IP. Use original forms and assets.

## Gameplay composition
Portrait mobile first.
1. Minimal HUD at edges.
2. English prompt around upper-middle, never at extreme top/bottom.
3. Time/magic gauge immediately below prompt.
4. Three answers are integrated into three paths/gates in the world, not detached quiz buttons.
5. Lumi occupies roughly the lower-middle region and runs AWAY from camera into the world.
6. Forward view must remain open enough to anticipate the next spectacle/obstacle.

The eye should stay on one vertical corridor: WORD -> TIME -> THREE PATHS -> LUMI.

## Visual non-negotiables
- No emoji or placeholder-looking hero/enemy art in final visual mode.
- No flat geometric landscape presented as finished art.
- No generic rounded dashboard UI floating over the game unless essential.
- No large opaque panels covering the fantasy world during normal play.
- No front-facing running pose.
- No static-feeling runner: foot plant, body compression, hair/cloth follow-through, camera response, ground motion and particles are required.
- No visual-complete claim based only on unit/self tests.

## Environment target
Worlds should feel materially different, not palette swaps. Initial visual families:
- luminous sky ruins / floating islands
- magical emerald forest / water ruins
- aurora ice realm
- dark eclipse castle / volcanic realm
- celestial sky temple

Each needs foreground, midground, background and sky/atmosphere layers. Strong depth cues and changing landmarks are mandatory.

## Motion target
- Continuous forward movement.
- Camera breathing/bob is subtle; landing impacts are stronger.
- Lateral choice is a committed lane move followed by visual recentering for the next question.
- Hair, ribbon, cape and accessories lag behind body motion.
- Correct answer: physical success in the world (bridge forms, leap clears, gate opens, spell breaks obstacle).
- Wrong answer: physical failure with readable comedy/drama (slip, crash, fall, hat fly), not just red text.
- Low time: world pressure increases visually without destroying answer readability.

## Time gauge
Use an in-world magical gauge directly beneath the word. It must create pressure without forcing the eye away from the path. 50% = energy/color shift, 25% = pulse, 10% = urgent pulse + sound/haptic where available, 0 = dedicated timeout failure motion.

## Art pipeline
Do NOT ask engineering to invent final art from prose alone.
For every major visual, provide:
1. approved reference/concept image,
2. measurable layout/spec,
3. asset list/layer plan,
4. motion/state requirements,
5. screenshot/video comparison after implementation.

When a real art asset is unavailable, use an explicit temporary asset and label it temporary. Do not disguise procedural primitives as final art.

## Implementation order
P0: gameplay camera + composition + prompt/time/path readability
P0: Lumi gameplay silhouette and run motion
P0: first world visual quality
P1: correct/wrong physical set pieces
P1: boss encounter presentation
P1: title screen
P2: remaining worlds and meta screens

## Visual Judge
Every candidate build is judged from real screenshots/video, not code claims. Score 0–10 each:
- first impression
- character appeal
- world spectacle
- depth/lighting/material quality
- running motion
- gameplay readability
- success payoff
- failure entertainment
- desire to continue
- social/store screenshot appeal

90/100 required before production promotion. If the owner says it looks dated/childish/unexciting, it fails regardless of internal score.

## Current implementation instruction
Work on branch visual-master-v1. Production must remain untouched until visual approval. Preserve the existing 2,894-approved-word vocabulary engine, anti-duplicate/confusable logic, and time-pressure system unless a visual integration requires a compatible refactor.
