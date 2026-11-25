# Christmas Party Memory Match

An interactive, offline-ready **Picture Memory Matching Game** built with plain HTML, CSS, and vanilla JavaScript.

## Files Included

- `index.html` — Game layout, MC controls, and completion/setup dialogs
- `style.css` — Festive Christmas theme, 3D card-flip animations, and projector/mobile responsive grid
- `script.js` — Image configuration, card shuffling, matching logic, and Web Audio sound effects
- `images/` — Folder where you place your own pictures

## How to Add Your Own Pictures

1. Copy your pictures into the `images/` folder (supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`).
2. Open `script.js` and edit the `images` array inside `GAME_CONFIG` at the top of the file:

```javascript
const GAME_CONFIG = {
  imageFolder: 'images/',

  images: [
    'family-dinner.jpg',
    'santa-hat.png',
    'christmas-tree.jpg',
    'ugly-sweater.jpg',
    'reindeer.png',
    'snowball.jpg'
  ],

  defaultPairs: 6,
  mismatchDelayMs: 1000
};
```

3. Each filename you list is **automatically duplicated** to create a matching pair and shuffled every time a new game starts.
4. To **add or remove pairs**, simply add or delete filenames in `GAME_CONFIG.images`—the **Pairs** selector in the game header updates automatically.

## Running Offline at Your Party

No internet connection or database is needed. Simply keep `index.html`, `style.css`, `script.js`, and the `images/` folder together in the same folder on your laptop and double-click `index.html` to open it in any modern browser.

### MC Shortcuts
- **Click any card** (guests can call out the card numbers printed on the backs)
- **`R`** — Restart & shuffle a new game
- **`M`** — Mute / unmute sound effects
- **`Esc`** — Close open dialogs
