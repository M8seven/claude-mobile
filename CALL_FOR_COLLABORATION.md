# We Built Claude Code for iPad. It Works. Now We Need Help to Make It Great.

**claude-mobile** is the first working implementation of an agentic AI coding tool running entirely on iPad. Not a concept. Not a mockup. A working tool that we used to build itself.

Claude reads your code, edits files, searches your codebase, commits and pushes to GitHub — all from an iPad, all autonomously. Here's what we built and how:

### Working Features

**Agentic coding loop.** Claude reads your codebase, plans changes, edits files, verifies results — autonomously, in a loop. Just like Claude Code on desktop, but from an iPad. You describe what you want, Claude does the work.

**7 integrated tools**, all executing locally on the iPad:
- **Read** — read files with line numbers, supports offset/limit for large files
- **Write** — create or overwrite files, auto-creates directories
- **Edit** — surgical string replacement in files (find unique string, replace it)
- **Glob** — find files by pattern (`**/*.js`, `src/**/*.ts`) across the project
- **Grep** — regex search across file contents with context lines
- **Bash** — shell command execution with a 3-tier fallback: native shell > remote relay > JS polyfill (~25 Unix commands: ls, cat, head, tail, mkdir, rm, cp, mv, find, grep, sed, sort, uniq, wc, tree, xargs, and more)
- **Git** — full Git operations via isomorphic-git (status, add, commit, push, pull, log, diff, branch, checkout) with GitHub token authentication

**Real streaming.** Responses stream token-by-token via SSE. You see Claude thinking in real time — text appears as it's generated, tool calls show as they happen with their results.

**Conversation history.** Multi-turn conversations with full context. Claude remembers what it read, what it edited, what failed. It builds on previous tool results to make informed decisions.

**Multiple interfaces**, all functional:
- **Web UI** (`web.js`) — self-contained Node.js server: serves HTML, proxies API calls, executes tools. One process, one command, everything works. Includes auto-resizing textarea, markdown rendering, tool result display.
- **CLI** (`cli.js`) — terminal-based interface for direct use in a-Shell, with streaming output and tool call visualization
- **Split architecture** (`claude-mobile.py` + `index.html`) — Python server handles tools, browser calls Anthropic API directly via CORS. Lightweight, works with just Python 3.

### How It Works Technically

The system prompt tells Claude about the available tools and the working directory. When Claude decides to use a tool, the API returns a `tool_use` content block. The client extracts the tool name and input, executes it locally (file system operations, shell commands, git), sends the result back as a `tool_result`, and Claude continues its reasoning. This loop repeats up to 50 iterations per message — enough for complex multi-file refactors.

The JS shell polyfill deserves special mention: on iPad (where `child_process` isn't available), we implemented a complete shell parser with quote-aware splitting, pipe chains (`cmd1 | cmd2`), command chaining (`cmd1 && cmd2`), output redirection (`>`, `>>`), and ~25 commands — all in pure JavaScript. It's not a toy; it handles real workflows.

Git operations use isomorphic-git, which runs entirely in JavaScript — no native git binary needed. Clone, commit, push, pull all work from the iPad's sandboxed filesystem.

### What This Means

We can sit on a couch with an iPad, open a browser, tell Claude "refactor the authentication module to use JWT", and watch it:
1. Search the codebase for auth-related files
2. Read the current implementation
3. Plan the changes
4. Edit multiple files
5. Verify the edits are consistent
6. Commit and push

**This works today.** We've used it to develop claude-mobile itself — dogfooding from day one.

---

## The Wall

iPad imposes constraints that prevent us from reaching the final goal: a seamless, single-app experience.

### 1. No single-app experience
Currently, the user must: (a) open a-Shell to start the server, (b) switch to Safari to use the UI. We want: tap one icon, start coding. iOS Shortcuts can chain these steps, but it's fragile.

### 2. No persistent background processes
iOS aggressively suspends apps. The local server (needed for tool execution) can be killed when the user switches apps. A long Claude operation gets interrupted mid-stream.

### 3. No real shell
You can't run `npm install`, `python`, `make`, `cargo`, or any build/test tooling natively on iPad. Our JS polyfill covers file operations, but Claude Code's real power comes from executing arbitrary commands — running tests, building projects, checking output. Without this, it's a smart editor, not a full coding agent.

### 4. IndexedDB is volatile on iOS Safari
Apple purges IndexedDB storage after ~7 days of inactivity. A pure browser-based approach (using isomorphic-git + LightningFS) means cloned repos can vanish.

### 5. Sandboxed filesystem
No shared filesystem where a server process and a PWA can both access the same project files seamlessly.

---

## What We're Looking For

### Platform & Runtime
- **iOS app development** (Swift/SwiftUI) — could a native app bundle a JS runtime (JavaScriptCore, Hermes) + local HTTP server + WKWebView for the single-app experience?
- **a-Shell / iSH / UTM internals** — tricks for persistent background execution or filesystem sharing
- **WebContainers / Stackblitz approach** — running Node.js entirely in the browser via WebAssembly. Could this eliminate the need for a server?

### Architecture
- **Hybrid app architecture** — embedding a web UI + local tool-execution engine in a single iOS app
- **Background execution on iOS** — patterns for keeping a lightweight server alive (BGTaskScheduler, audio background mode, etc.)
- **Persistent storage** — alternatives to IndexedDB that survive iOS purges

### Developer Experience
- **Mobile-first code editing UX** — touch-friendly interfaces for code review, diffing, file navigation
- **iPad keyboard management** — virtual keyboard handling in chat-based UIs (`dvh` units, `visualViewport` API)

## What We're NOT Looking For

- "Just SSH into a server" — we want local-first, works offline
- "Wait for Apple to fix it" — we want to push boundaries today
- "Use a laptop" — the whole point is coding from iPad, anywhere

## Architecture

```
iPad (a-Shell)                          Anthropic API
+-----------------------+              +---------------+
|  claude-mobile.py     |              |  Claude API   |
|  - HTTP server        |              |  (streaming)  |
|  - Tool execution     |              +-------+-------+
|    Read/Write/Edit    |                      |
|    Glob/Grep/Bash/Git |                      |
+-----------+-----------+                      |
            | localhost:3000                   |
+-----------+----------------------------------+------+
|  Safari / PWA                                       |
|  index.html                                         |
|  - Chat UI with streaming                           |
|  - Direct API calls to Anthropic (CORS)             |
|  - Tool calls to local server                       |
|  - Markdown rendering, tool result display          |
|  - Agentic loop (up to 50 iterations)               |
+-----------------------------------------------------+
```

## The Dream

One app icon. Tap it. It asks which repo you want to work on (connected to your GitHub). Pick one. Clone (or open if already cached). Claude is ready. You code, Claude helps — reading files, writing code, running tests, committing, pushing. All from your iPad. No terminal. No setup. No fragility.

## Get Involved

- **Repository:** [github.com/M8seven/claude-mobile](https://github.com/M8seven/claude-mobile)
- **Issues:** Open an issue tagged `[collaboration]` with your area of expertise
- **PRs:** Welcome, especially for the platform challenges above

We believe mobile-first AI coding is inevitable. We need help getting past the last mile.

**Author:** [@M8seven](https://github.com/M8seven)

---

# Abbiamo Costruito Claude Code per iPad. Funziona. Ora Ci Serve Aiuto per Renderlo Grande.

**claude-mobile** e la prima implementazione funzionante di un tool di coding agentico con AI che gira interamente su iPad. Non un concept. Non un mockup. Un tool funzionante che abbiamo usato per sviluppare se stesso.

Claude legge il tuo codice, edita file, cerca nel codebase, committa e pusha su GitHub — tutto da un iPad, tutto autonomamente. Ecco cosa abbiamo costruito e come:

### Funzionalita Operative

**Loop di coding agentico.** Claude legge il codebase, pianifica le modifiche, edita i file, verifica i risultati — autonomamente, in un loop. Esattamente come Claude Code su desktop, ma da un iPad. Descrivi cosa vuoi, Claude fa il lavoro.

**7 tool integrati**, tutti eseguiti localmente sull'iPad:
- **Read** — legge file con numeri di riga, supporta offset/limit per file grandi
- **Write** — crea o sovrascrive file, crea directory automaticamente
- **Edit** — sostituzione chirurgica di stringhe nei file (trova stringa unica, sostituiscila)
- **Glob** — trova file per pattern (`**/*.js`, `src/**/*.ts`) nell'intero progetto
- **Grep** — ricerca regex nei contenuti dei file con righe di contesto
- **Bash** — esecuzione comandi shell con fallback a 3 livelli: shell nativa > relay remoto > polyfill JS (~25 comandi Unix: ls, cat, head, tail, mkdir, rm, cp, mv, find, grep, sed, sort, uniq, wc, tree, xargs e altri)
- **Git** — operazioni Git complete via isomorphic-git (status, add, commit, push, pull, log, diff, branch, checkout) con autenticazione via token GitHub

**Streaming reale.** Le risposte arrivano token per token via SSE. Vedi Claude che pensa in tempo reale — il testo appare mentre viene generato, le tool call appaiono man mano con i risultati.

**Cronologia conversazione.** Conversazioni multi-turno con contesto completo. Claude ricorda cosa ha letto, cosa ha editato, cosa e fallito. Costruisce sulle decisioni precedenti.

**Interfacce multiple**, tutte funzionanti:
- **Web UI** (`web.js`) — server Node.js autocontenuto: serve HTML, proxy delle API call, esecue tool. Un processo, un comando, tutto funziona. Include textarea auto-resize, rendering markdown, visualizzazione risultati tool.
- **CLI** (`cli.js`) — interfaccia terminale per uso diretto in a-Shell, con output streaming e visualizzazione tool call
- **Architettura split** (`claude-mobile.py` + `index.html`) — server Python gestisce i tool, il browser chiama l'API Anthropic direttamente via CORS. Leggera, funziona con solo Python 3.

### Come Funziona Tecnicamente

Il system prompt dice a Claude quali tool ha a disposizione e la directory di lavoro. Quando Claude decide di usare un tool, l'API restituisce un content block `tool_use`. Il client estrae nome e input del tool, lo esegue localmente (operazioni su filesystem, comandi shell, git), manda il risultato come `tool_result`, e Claude continua il ragionamento. Questo loop si ripete fino a 50 iterazioni per messaggio — abbastanza per refactoring complessi su piu file.

Il polyfill JS per la shell merita una menzione speciale: su iPad (dove `child_process` non e disponibile), abbiamo implementato un parser shell completo con splitting quote-aware, pipe chain (`cmd1 | cmd2`), concatenamento comandi (`cmd1 && cmd2`), redirezione output (`>`, `>>`), e ~25 comandi — tutto in puro JavaScript. Non e un giocattolo; gestisce workflow reali.

Le operazioni Git usano isomorphic-git, che gira interamente in JavaScript — nessun binario git nativo necessario. Clone, commit, push, pull funzionano tutti dal filesystem sandboxato dell'iPad.

### Cosa Significa

Possiamo sederci sul divano con un iPad, aprire un browser, dire a Claude "rifai il modulo di autenticazione usando JWT", e guardarlo:
1. Cercare nel codebase i file relativi all'auth
2. Leggere l'implementazione attuale
3. Pianificare le modifiche
4. Editare piu file
5. Verificare che le modifiche siano coerenti
6. Committare e pushare

**Questo funziona oggi.** Lo abbiamo usato per sviluppare claude-mobile stesso — dogfooding dal primo giorno.

---

## Il Muro

iPad impone vincoli che ci impediscono di raggiungere l'obiettivo finale: un'esperienza fluida in una singola app.

### 1. Nessuna esperienza single-app
Attualmente l'utente deve: (a) aprire a-Shell per avviare il server, (b) passare a Safari per usare la UI. Vogliamo: tocca un'icona, inizi a codare. iOS Shortcuts puo concatenare i passaggi, ma e fragile.

### 2. Nessun processo in background persistente
iOS sospende aggressivamente le app. Il server locale (necessario per l'esecuzione dei tool) puo essere killato quando l'utente cambia app. Un'operazione lunga di Claude viene interrotta a meta.

### 3. Nessuna shell vera
Non puoi eseguire `npm install`, `python`, `make`, `cargo`, o qualsiasi tooling di build/test nativamente su iPad. Il nostro polyfill JS copre le operazioni su file, ma il vero potere di Claude Code viene dall'eseguire comandi arbitrari — lanciare test, buildare progetti, controllare output. Senza questo, e un editor intelligente, non un coding agent completo.

### 4. IndexedDB e volatile su iOS Safari
Apple cancella lo storage IndexedDB dopo ~7 giorni di inattivita. Un approccio puramente browser-based (usando isomorphic-git + LightningFS) significa che i repo clonati possono sparire.

### 5. Filesystem sandboxato
Nessun filesystem condiviso dove un processo server e una PWA possano accedere agli stessi file di progetto senza problemi.

---

## Cosa Cerchiamo

### Piattaforma & Runtime
- **Sviluppo app iOS** (Swift/SwiftUI) — un'app nativa potrebbe includere un runtime JS (JavaScriptCore, Hermes) + server HTTP locale + WKWebView per l'esperienza single-app?
- **Internals di a-Shell / iSH / UTM** — trick per esecuzione persistente in background o condivisione filesystem
- **Approccio WebContainers / Stackblitz** — eseguire Node.js interamente nel browser via WebAssembly. Potrebbe eliminare la necessita del server?

### Architettura
- **Architettura app ibrida** — integrare web UI + engine locale di esecuzione tool in una singola app iOS
- **Esecuzione in background su iOS** — pattern per mantenere attivo un server leggero (BGTaskScheduler, audio background mode, ecc.)
- **Storage persistente** — alternative a IndexedDB che sopravvivano alle purge di iOS

### Developer Experience
- **UX di code editing mobile-first** — interfacce touch-friendly per code review, diffing, navigazione file
- **Gestione tastiera iPad** — gestione della tastiera virtuale in UI chat-based (unita `dvh`, API `visualViewport`)

## Cosa NON Cerchiamo

- "Basta fare SSH su un server" — vogliamo local-first, funziona offline
- "Aspettate che Apple sistemi le cose" — vogliamo spingere i limiti oggi
- "Usate un laptop" — il punto e proprio codare da iPad, ovunque

## Architettura

```
iPad (a-Shell)                          Anthropic API
+-----------------------+              +---------------+
|  claude-mobile.py     |              |  Claude API   |
|  - Server HTTP        |              |  (streaming)  |
|  - Esecuzione tool    |              +-------+-------+
|    Read/Write/Edit    |                      |
|    Glob/Grep/Bash/Git |                      |
+-----------+-----------+                      |
            | localhost:3000                   |
+-----------+----------------------------------+------+
|  Safari / PWA                                       |
|  index.html                                         |
|  - Chat UI con streaming                            |
|  - Chiamate API dirette ad Anthropic (CORS)         |
|  - Tool call verso server locale                    |
|  - Rendering Markdown, visualizzazione tool result  |
|  - Loop agentico (fino a 50 iterazioni)             |
+-----------------------------------------------------+
```

## Il Sogno

Un'icona. La tocchi. Ti chiede su quale repo vuoi lavorare (gia connessa al tuo GitHub). Ne scegli uno. Clone (o apre se gia in cache). Claude e pronto. Scrivi codice, Claude ti aiuta — legge file, scrive codice, lancia test, committa, pusha. Tutto dal tuo iPad. Nessun terminale. Nessun setup. Nessuna fragilita.

## Come Partecipare

- **Repository:** [github.com/M8seven/claude-mobile](https://github.com/M8seven/claude-mobile)
- **Issue:** Apri una issue con tag `[collaboration]` indicando la tua area di competenza
- **PR:** Benvenute, specialmente per le sfide di piattaforma sopra elencate

Crediamo che il coding mobile-first con AI sia inevitabile. Abbiamo bisogno di aiuto per superare l'ultimo miglio.

**Autore:** [@M8seven](https://github.com/M8seven)
