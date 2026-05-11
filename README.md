# Imposter: Party Word Game

A minimal, multilingual party word game where players try to find the hidden imposter.

The goal is simple:

```txt
Open the app → Choose language → Pick category → Pass the phone → Reveal roles → Talk → Vote → Laugh
```

## Core Idea

**Imposter** is a local party game designed for real-life groups.

Most players receive the same secret word. One or more players are secretly assigned as imposters. The group discusses the word without saying it directly, while the imposter tries to blend in, figure out the word, and avoid getting caught.

The main difference from traditional word-list games is that this app uses AI [Artificial Intelligence] to generate words dynamically based on the selected language and category.

This allows the game to support many languages without storing a huge database of words.

## Main Selling Point

A global imposter party game that works in many languages.

No massive word database.  
No complicated setup.  
No accounts required for the first version.  
Just pick a language, choose a category, and play.

## MVP [Minimum Viable Product] Features

- Local party mode
- One phone passed around between players
- Language selection
- Category selection
- Player count selection
- Player name entry
- One or more imposters
- AI-generated secret word
- AI-generated imposter hint
- Private role reveal screen
- Discussion phase
- Optional discussion timer
- Voting screen
- Result reveal screen
- Imposter word-guessing chance
- Local scoreboard
- Play again flow

## Game Flow

1. The host opens the app.
2. The host selects a language.
3. The host selects a category.
4. The host enters the number of players.
5. Players enter their names.
6. The host chooses the number of imposters.
7. The app generates the secret word and imposter hint using AI.
8. Each player privately reveals their role.
9. Normal players see the secret word.
10. The imposter sees that they are the imposter and receives a broad hint.
11. Players discuss the word without saying it directly.
12. Players vote on who they think the imposter is.
13. The app reveals whether the vote was correct.
14. If the imposter is caught, they may get one chance to guess the secret word.
15. The winner is announced.
16. Scores are updated.
17. The group can play another round.

## Game Rules

Normal players know the secret word.

The imposter does not know the secret word.

The imposter receives a broad hint to help them survive the first discussion without making the game too easy.

Players take turns saying something related to the word. They must be careful not to make the word too obvious.

After discussion, everyone votes for the player they think is the imposter.

## Example Round

Category:

```txt
Food
```

Language:

```txt
English
```

Secret word:

```txt
Pizza
```

Imposter hint:

```txt
Food
```

Normal players see:

```txt
Your word is: Pizza
```

The imposter sees:

```txt
You are the Imposter.

Hint: Food
```

Possible discussion:

```txt
Player 1: People eat this with friends.
Player 2: It is usually hot.
Player 3: You can order it at restaurants.
Player 4: It can have cheese.
```

Then the group discusses and votes.

## Imposter Hint System

The imposter should not receive a different similar word.

The imposter only receives:

1. Their role
2. A broad hint

Good hints are general enough to keep the game challenging, but helpful enough for the imposter to say something close during the first talking round.

### Good Hints

```txt
Food
Animal
Place
Object
Sport
Movie
Job
Country
Something people use
Something people eat
Something you can find outside
Something you can find at home
```

### Bad Hints

```txt
Italian food
Cheesy food
Round food
Delivery food
Fast food
```

Bad hints are too specific and may reveal the secret word too easily.

## AI Word Generation

The app should call an AI API [Application Programming Interface] once per round to generate the secret word and imposter hint.

Users should never type raw prompts. Users only choose simple options like language, category, player count, and number of imposters.

Example AI response:

```json
{
  "language": "English",
  "category": "Food",
  "mainWord": "Pizza",
  "imposterHint": "Food",
  "difficulty": "easy"
}
```

The hint should help the imposter say something generally related during the first discussion, but it should not make the word obvious.

## AI Safety Rules

Generated words should be:

- Simple
- Familiar
- Culturally understandable
- Safe for groups
- Easy to discuss
- Not offensive
- Not sexual
- Not political
- Not religious
- Not hateful
- Not too obscure

## Categories

Initial categories may include:

- Food
- Animals
- Jobs
- Countries
- Objects
- Sports
- School
- Movies
- Celebrities
- Fantasy
- Random

More categories can be added later.

## Languages

The app should be designed to support many languages.

The first version can start with a smaller set of common languages, then expand.

Possible early languages:

- English
- Russian
- Uzbek
- Spanish
- Turkish
- Arabic
- French
- German
- Portuguese
- Hindi

All visible app text should eventually support localization.

## Scoring

Basic scoring idea:

- Normal players win if they correctly vote out the imposter.
- The imposter wins if they survive the vote.
- If the imposter is caught but correctly guesses the secret word, the imposter can still win.

Possible point system:

```txt
Normal players win: +1 point each
Imposter survives: +2 points
Imposter guesses the word after being caught: +2 points
```

## Monetization

The app will be completely free at launch.

The first version should not include:

- Paid downloads
- Subscriptions
- In-app purchases
- Ads

The early goal is to grow usage, improve the game loop, collect feedback, and make the app fun enough that people naturally share it with friends.

Monetization should only be considered after the app gains real traction and has consistent active users.

Possible future monetization options:

- Premium categories
- Custom game modes
- Saved player groups
- Party packs
- Advanced settings

Ads should never appear during important gameplay moments, such as:

- Role reveal
- Discussion
- Voting
- Result reveal

If ads are added later, they should only appear at natural breaks, such as:

- After a round ends
- Before starting a new round
- After several completed rounds

The priority is:

```txt
Build a fun game first → Grow users → Monetize later
```

## Design Principles

The app should feel:

- Minimal
- Fast
- Smooth
- Clean
- Global
- Easy to understand
- Fun within 60 seconds

The design should avoid clutter.

The user should never feel like they are setting up a business dashboard just to play a party game.

The ideal experience:

```txt
Open app → Choose settings → Pass phone → Laugh
```

## Screens

Planned screens for the first version:

1. Splash Screen
2. Home Screen
3. Game Setup Screen
4. Player Setup Screen
5. Pass Phone Screen
6. Role Reveal Screen
7. Discussion Screen
8. Voting Screen
9. Result Screen
10. Scoreboard Screen
11. Settings Screen
12. How to Play Screen

## Core Screens

### Home Screen

The home screen should be simple.

Main actions:

```txt
Play
How to Play
Settings
```

Future actions:

```txt
Premium
Stats
Online Mode
```

Online mode should not be part of the first version.

### Game Setup Screen

The host chooses:

- Language
- Category
- Number of players
- Number of imposters
- Discussion timer
- Difficulty

### Player Setup Screen

Players enter their names.

Example:

```txt
Player 1
Player 2
Player 3
Player 4
```

Custom names should be supported.

### Pass Phone Screen

Before each reveal, the app should show:

```txt
Pass the phone to Player 1
```

Then the player taps:

```txt
Reveal
```

This prevents accidental role leaks.

### Role Reveal Screen

Normal player:

```txt
Your word is: Flag
```

Imposter:

```txt
You are the Imposter.

Hint: Wind
```

After viewing, the player taps:

```txt
Hide
```

Then the phone is passed to the next player.

### Discussion Screen

The app shows:

```txt
Discussion Time
```

Optional timer:

```txt
1 minute
2 minutes
3 minutes
5 minutes
No timer
```

### Voting Screen

The app shows all players.

Example:

```txt
Who is the Imposter?

Player 1
Player 2
Player 3
Player 4
```

The group votes in real life, then the host selects the chosen player.

### Result Screen

If the group voted correctly:

```txt
Correct!

Player 3 was the Imposter.
```

If the group voted incorrectly:

```txt
Wrong!

Player 3 was not the Imposter.
The Imposter survives.
```

If the imposter is caught, the app can allow one final guess:

```txt
Imposter, guess the secret word.
```

If the imposter guesses correctly:

```txt
The Imposter guessed the word and wins!
```

If the imposter guesses incorrectly:

```txt
The players win!
```

## Future Features

Possible future additions:

- Online multiplayer
- Public rooms
- Private invite codes
- Friend groups
- Custom word packs
- User-created categories
- Voice-based clues
- Party statistics
- Leaderboards
- Daily challenges
- Family-safe mode
- Regional word styles
- Offline cached words

Online multiplayer should not be part of the first version.

The first goal is to make the local party game excellent.

## Technical Notes

The app should be built with a clean structure that separates:

- Game state
- Player setup
- AI word generation
- Round logic
- Score logic
- UI [User Interface] components
- Localization
- Monetization
- Settings

The AI call should happen once per round, not during every screen change.

Generated words and hints can be cached locally to reduce API cost and improve speed.

## Development Priority

The first version should focus on the core loop:

```txt
Setup → Generate Word and Hint → Reveal Roles → Discuss → Vote → Reveal Result → Play Again
```

Do not overbuild.

Avoid accounts, online matchmaking, complex profiles, chat systems, or leaderboards until the local game is polished.

## Project Goal

The goal of this project is to build a simple but addictive multilingual imposter party game that can be played by groups anywhere in the world.

The first success metric is not downloads, revenue, or advanced features.

The first success metric is:

```txt
Can four people open the app and start laughing within one minute?
```

If yes, the foundation is strong.