# Illuminable Room Modeler

A React + TypeScript simulator that visualizes light ray reflections and billiard trajectories inside a triangular "room." It uses the mathematical "unfolding" technique — reflecting the triangle across each wall it hits — to turn bouncing paths into straight lines through a chain of mirrored triangles.

## Features

- **Ray Simulator** — Fire a light ray from any vertex at any angle and watch it bounce (via unfolding) up to a configurable number of times, with automatic detection of singularities (when a ray hits exactly back on its starting vertex).
- **Code Unfolder** — Paste a space-separated numeric sequence (e.g. `3 1 7 2 6 2 8 2 4 2`) to generate a full scripted billiard trajectory, automatically mapped onto the triangle's real geometric angles.
- **Flexible triangle input** — Define the base triangle by raw (x, y) coordinates or by two angles + base length (Law of Sines).
- **Interactive canvas** — Pan, zoom, and inspect calculated vertex coordinates for every reflection step.

## Tech Stack

| Tool | Purpose |
|---|---|
| [Vite](https://vitejs.dev) | Dev server & build tool |
| [React](https://react.dev) + TypeScript | UI framework (`.tsx`) |
| [Tailwind CSS](https://tailwindcss.com) | Styling |
| [lucide-react](https://lucide.dev) | Icons |

## Prerequisites

- [Node.js](https://nodejs.org) (v18+) and npm — check with `node -v` and `npm -v`
- [Git](https://git-scm.com) and a GitHub account
- [VS Code](https://code.visualstudio.com) (recommended editor)

## Getting Started (Local Development)

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/illuminable-room-modeler.git
   cd illuminable-room-modeler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open the URL shown in the terminal (usually `http://localhost:5173`). The app hot-reloads automatically whenever you save a file.

## Project Structure

```
illuminable-room-modeler/
├── src/
│   ├── App.tsx        # Main component — all simulation logic + UI
│   ├── main.tsx        # React entry point
│   └── index.css        # Tailwind import
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

## Building for Production

```bash
npm run build
```
This outputs an optimized static build into the `dist/` folder.

To preview the production build locally before deploying:
```bash
npm run preview
```

## Deploying to Test It Live

The easiest free option is **Vercel** or **Netlify**, both of which auto-detect Vite projects.

### Option A: Vercel
1. Push your repo to GitHub (see Collaboration section below).
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click **Add New → Project**.
3. Select this repository. Vercel auto-detects the Vite framework preset — leave build command as `npm run build` and output directory as `dist`.
4. Click **Deploy**. You'll get a live URL (e.g. `illuminable-room-modeler.vercel.app`) that updates automatically on every push to `main`.

### Option B: Netlify
1. Go to [netlify.com](https://netlify.com), sign in with GitHub, click **Add new site → Import an existing project**.
2. Select this repo. Set build command to `npm run build` and publish directory to `dist`.
3. Click **Deploy site**.

### Option C: GitHub Pages
1. Install the deploy helper: `npm install --save-dev gh-pages`
2. Add to `package.json` scripts: `"deploy": "vite build && gh-pages -d dist"`
3. Set `base: '/illuminable-room-modeler/'` in `vite.config.ts` (must match your repo name).
4. Run `npm run deploy`, then enable GitHub Pages in repo Settings → Pages, using the `gh-pages` branch.

## Collaborating

1. Repo owner: go to **Settings → Collaborators → Add people**, invite teammates by GitHub username/email with **Write** access.
2. Collaborators: accept the email invite, then clone and install as shown above.
3. Recommended workflow: create a feature branch before editing (`git checkout -b your-feature-name`), push it, and open a Pull Request into `main` instead of committing directly to `main`.

## Core Concepts (Quick Reference)

- `reflectPoint(p, p1, p2)` — mirrors a point across a line using linear algebra; the core function behind every bounce.
- `baseTriangle` — builds the starting triangle from coordinate or angle+length input (Law of Sines).
- `rayData` — casts a single ray and computes each reflected triangle via edge-intersection math (Cramer's rule).
- `codeData` — parses a numeric billiard code into a sequence of triangle reflections using parity rules and Law of Cosines angle-matching.

## License

Add a license of your choice (e.g. MIT) via GitHub's **Add file → Create new file → LICENSE** template picker.
