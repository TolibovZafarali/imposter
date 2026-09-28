# Eligibility audit

Read all 351 initially excluded entries in `eligibility-review.json`, checked the source catalog clues for the candidates below, and compared related accepted entries. Following this review, the nine corrections below were applied to that review file, leaving 342 excluded entries. This is a classification review before artwork generation, not visual approval of ungenerated artwork. The main manifest, original alias review, and all unrelated review records remain unchanged; no classification import or build was run.

## Corrections applied to the review

| Canonical ID | Finding and proposed depiction |
| --- | --- |
| `activities-medium-escape-room` | The same activity is already eligible as `sports-easy-escape-room`, with a puzzle-room cutaway, locked door, key, and physical puzzle. Reuse that exact meaning and artwork rather than excluding this occurrence. |
| `activities-easy-fixing` | Physical fixing is visibly depictable in the same repair sense already accepted for `activities-easy-repairing` and `activities-medium-home-repair`. Select that ordinary physical sense and reuse repairing artwork where the final depiction agrees. The broad clue “solution” does not require an abstract interpretation. |
| `food-medium-gelatin` | The exclusion assumes an indistinct powder/ingredient, but the source clue is “jiggle.” Set gelatin has a visible molded form, like the accepted jello/jelly subjects. Select the set-food sense supported by the clue; inspect the final depiction before deciding whether a dessert alias is equivalent. |
| `activities-medium-fitness-class` | A leader and a few participants performing the same exercise visibly depict this activity. Its exclusion is inconsistent with accepted group activities such as Zumba and gardening club; no written lesson content is needed. |
| `objects-easy-id-card` | A portrait panel and chip on a physical identification badge give this concrete object an ordinary recognizable depiction without legible personal information. The source clue “verification” supports this sense. |
| `food-medium-coconut-water` | Show clear liquid in an opened young coconut with a simple straw. The natural serving supplies distinguishing context without a written bottle label; white coconut milk can remain visually separate. |
| `objects-easy-eye-drops` | A small pointed-nozzle bottle dispensing one drop above an eye depicts the product's use without labeling. This needs only essential context, comparable to the accepted contact lens shown on a fingertip. |
| `sports-easy-timeout` | An official or player making the recognizable T hand signal depicts the sports timeout request. The classification currently treats the word only as an invisible duration. |
| `sports-medium-bracket` | A compact branching elimination-bracket diagram remains identifiable with empty participant boxes and no words. The accepted blank scoreboard, crossword, and Sudoku grids already use comparable unlettered visual structure. |

## Additional candidates to reconsider individually

These four remain excluded. Their review records now state concrete reasons rather than a broad category-level explanation.

- `activities-easy-news-reading`: the proposed unlettered folded sheet could be a magazine or other reading material; generic reading would not establish the news-specific activity.
- `activities-medium-personal-training`: spotting or guiding an exerciser does not establish the trainer-client relationship; the same scene can show ordinary exercise partners.
- `objects-easy-receipt`: an unlettered thermal strip could be a ticket or generic printout; its completed-purchase purpose depends on the transaction content.
- `food-hard-sake`: a ceramic flask and cups provide serving context but do not establish what liquid they contain; no sufficiently distinct depiction has been selected.

## Additional alias proposals

`additional-alias-review.json` proposes three mappings after classification: activity escape room to the identical sports escape-room sense; physical fixing to repairing; and set gelatin dessert to jello. Both gelatin and jello have the exact source clue “jiggle,” supporting the same set dessert. Powdered gelatin, fruit preserves, and more specific repair activities are not included in these equivalences. The proposals do not approve any image or change the main manifest.

The remaining exclusions mainly involve genuinely invisible intent, transaction rules, duration, unresolved senses, or content that the no-lettering constraint removes. This review does not recommend blanket inclusion of those groups.

## Depicted-meaning sanity review

The backend's generated illustration-sense registry currently carries the complete art descriptions into the translation prompt. That prompt says the supplied sense takes precedence over other possible meanings. Keep that semantic disambiguation, but ensure incidental props, colors, counts, and style do not enlarge the translated word. Examples are the three-seat couch, the cracker beside cream cheese, the houseplant beside remote work, and the delivered parcel beside online shopping. The natural source-word equivalent should stay at the source word's specificity.

These accepted senses need particular attention when their images are reviewed:

- `activities-easy-audiobooks`: headphones plus a closed book may read as music beside a book. The book-listening meaning needs to remain recognizable.
- `activities-easy-podcast-listening` and `activities-easy-music-listening`: the phone's microphone icon carries much of the distinction. Inspect at the actual small-card size.
- `activities-medium-live-streaming`: “a live broadcast display” is underspecified when written interface cues are forbidden. Do not approve a generic camera presentation merely because the prompt mentions broadcasting.
- `sports-medium-exploding-kittens`: a generic kitten with a burst illustrates the phrase but may fail to identify the card game. The revised sense instead requires a compact fan of actual game cards with recognizable published kitten subjects, omitting all lettering. The publisher's [original-edition product page](https://www.explodingkittens.com/products/exploding-kittens-original-edition) and [rules](https://dumekj556jp75.cloudfront.net/exploding-kittens/English.pdf) identify a physical card game with illustrated kitten cards, so a nonverbal depiction is a plausible production candidate. This is an inference about feasibility, not proof that an ungenerated letter-free illustration will identify the game. Recognition at card size remains unresolved work; a generic kitten must not pass review.
- `sports-easy-olympics`: a generic ceremonial torch can be a related symbol without identifying the sporting event. Apply the same recognition standard used for excluded named events.
- Country, region, lake, and sea outlines: the broad template is acceptable as an intent, but tiny islands and actual outlines need subject-specific inspection. A prompt saying “accurate” does not itself verify geography.

No broader catalog, selection-weight, or gameplay changes are proposed.
