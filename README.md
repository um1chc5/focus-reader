# Focus Reader

Read a PDF one sentence or one word at a time, in English or Vietnamese.

**Live:** https://um1chc5.github.io/focus-reader/

## Features

- **Two reading views.** *Spotlight* lights the current sentence and dims the rest of the page. *Word* shows one word at a time at a fixed focus point. Both share the same position, and `M` switches between them.
- **Start anywhere.** The start-point dialog shows page thumbnails and each page's sentences. You can also search for a sentence or type a page number.
- **Search** the whole document (`F`, `/` or Ctrl+F). Accents are optional, so `nguyen` finds `Nguyễn`.
- **Library.** Every PDF you open is saved in the browser (IndexedDB), along with its cover and your reading position.
- **Vietnamese support.** The interface is translated, tone marks that come out split during extraction are fixed, sentences are split with Vietnamese rules, and Word view can show two syllables at a time.
- **Appearance panel.** Light, Dark or System mode, plus five color themes: Book, Paper, Blue, Gray and Sage. Themes live in `css/themes.css`.
- **Mini window.** Pop out a compact always-on-top Picture-in-Picture window (`I`) in Chrome/Edge, or an in-page draggable and resizable floating window as a fallback, supporting both Spotlight and Word modes.
- Full-screen reading, adjustable speed (slider or −/+), text size, and keyboard shortcuts.
- Everything runs in the browser. PDFs are never uploaded.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← → | Previous / next sentence |
| ↑ ↓ | Faster / slower |
| M | Switch Spotlight / Word |
| P | Choose start point |
| F, / | Search |
| L | Library |
| H | Hide / show the floating controls |
| I | Open / close mini window |
| T | Switch light / dark |
| Shift+F | Full screen |

## Project layout

```
index.html          Markup for every view
css/themes.css      Color themes (each with light + dark tokens)
css/styles.css      Layout and component styles
js/app.js           Entry point: opening files and books, views, language, keyboard
js/themes.js        Appearance panel (mode + palette) and full screen
js/reader.js        Spotlight and Word rendering, playback timing, speed, text size
js/mini.js          Mini window (Document Picture-in-Picture + draggable/resizable fallback)
js/search.js        In-document search bar
js/picker.js        Start-point dialog (thumbnails, sentences, dialog search)
js/library.js       Library shelf view
js/db.js            IndexedDB storage (books + original PDF files)
js/text.js          PDF text extraction, sentence splitting, language detection, accent folding
js/i18n.js          English and Vietnamese strings
js/samples.js       Built-in sample text
js/state.js         Shared state and preferences
```

There's no build step. The app uses plain ES modules and loads [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 from cdnjs.

## Run locally

ES modules need an HTTP server, so opening the file directly won't work. The project includes a small dev server with no dependencies (Node 18+):

```sh
npm run dev        # http://localhost:5173
```

## Limits

- Scanned PDFs (images only) have no text to extract and need OCR first.
- PDFs that use old Vietnamese font encodings (TCVN3, VNI) can't be decoded correctly.
- The library lives in the browser you used. Clearing site data removes it.
