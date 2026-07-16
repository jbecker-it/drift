# 🌊 Drift

**A local-first ADHD journaling app that helps you reflect, track moods, and build streaks — powered by AI, private by design.**

Drift is a web-based journaling tool built for people with ADHD who want a simple, distraction-free space to write, reflect, and grow. All your data stays on your device using IndexedDB, and AI-powered features (via OpenRouter) help you gain insights into your patterns — without ever sending your journal entries to a server.

---

## ✨ Features

- 📝 **Journal Entries with Auto-Save Drafts** — Write freely without worrying about losing progress. Drafts are saved automatically as you type.
- 🤖 **AI Reflections** — Get personalized reflections on your journal entries powered by OpenRouter AI models.
- 😊 **Mood Tracking** — Log your mood alongside entries to visualize emotional patterns over time.
- 🔥 **Streak System** — Build consistency with a streak tracker that encourages daily journaling.
- 💬 **AI Coach Chat** — Chat with one of three AI coach personalities: **Coach**, **Listener**, or **Challenger** — each with a unique approach to helping you reflect.
- 💡 **Topic Suggestions** — Never stare at a blank page again. AI-generated topic prompts tailored to your journaling history.
- 📊 **Data Export** — Export your journal data in JSON format for backup or migration.
- 📱 **Mobile-First Responsive Design** — Works beautifully on phones, tablets, and desktops.
- 🌙 **Dark Theme with Accessible Colors** — A carefully designed dark UI with WCAG-compliant contrast ratios.
- 🔒 **100% Local-First** — No servers, no accounts, no cloud storage. Your data lives on your device.

---

## 📸 Screenshots

| Home | Journal Entry | AI Coach |
|------|--------------|----------|
| ![Home](screenshots/home.png) | ![Journal Entry](screenshots/journal-entry.png) | ![AI Coach](screenshots/ai-coach.png) |

| Mood Tracker | Streaks | Settings |
|-------------|---------|----------|
| ![Mood Tracker](screenshots/mood-tracker.png) | ![Streaks](screenshots/streaks.png) | ![Settings](screenshots/settings.png) |

> 📌 *Replace the placeholder paths above with actual screenshot files. Recommended size: 1200×800px.*

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18+ |
| **Language** | TypeScript |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS |
| **Local Storage** | Dexie.js (IndexedDB) |
| **AI Integration** | OpenRouter API |
| **State Management** | React Context + Hooks |
| **Routing** | React Router |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 9+ (comes with Node.js)
- An **OpenRouter API key** ([get one here](https://openrouter.ai/keys))

### 1. Clone the Repository

```bash
git clone https://github.com/jbecker-it/drift.git
cd drift
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Server

```bash
npm run dev
```

The app will be available at **http://localhost:5173**.

> 💡 **No .env file needed!** API key and model are configured through the app's onboarding flow and stored locally in IndexedDB.

### 4. Build for Production

```bash
npm run build
```

The output will be in the `dist/` directory, ready to deploy to any static hosting service.

### 5. Preview the Production Build

```bash
npm run preview
```

---

## 🌐 Deployment

Drift is a static web app — no backend server required. Deploy the `dist/` folder to any static hosting provider.

### Option 1: Static Hosting (Vercel / Netlify / Cloudflare Pages)

**Vercel:**

```bash
npm i -g vercel
vercel
```

**Netlify:**

1. Push your repo to GitHub.
2. Connect the repo on [Netlify](https://app.netlify.com).
3. Set the build command to `npm run build` and the publish directory to `dist`.
4. Deploy.

**Cloudflare Pages:**

1. Push your repo to GitHub.
2. Go to [Cloudflare Pages](https://pages.cloudflare.com) and connect your repo.
3. Set the build command to `npm run build` and the output directory to `dist`.
4. Deploy.

### Option 2: Self-Hosting with Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/drift/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Then reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Option 3: Self-Hosting with Caddy

```Caddyfile
your-domain.com {
    root * /var/www/drift/dist
    file_server
    try_files {path} /index.html
}
```

### Option 4: Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Build and run:

```bash
docker build -t drift .
docker run -d -p 8080:80 drift
```

The app will be available at **http://localhost:8080**.

---

## ⚙️ Configuration

### API Key Setup

Drift uses [OpenRouter](https://openrouter.ai/) for AI features. You need to provide your own API key.

1. Create an account at [OpenRouter](https://openrouter.ai/).
2. Generate an API key at [openrouter.ai/keys](https://openrouter.ai/keys).
3. Enter the key in Drift's **onboarding wizard** or **Settings** page.

> 🔒 Your API key is stored locally in IndexedDB and never leaves your device.

### Model Selection

You can choose from hundreds of AI models for reflections and coaching — including many **free models**. The onboarding wizard fetches the full model list from OpenRouter and lets you filter by free/paid.

Set your preferred model in the **Settings** page at any time.

### AI Coach Personalities

Drift offers three AI coach personalities, each with a distinct communication style:

| Personality | Description |
|-------------|-------------|
| 🏋️ **Coach** | Encouraging and action-oriented. Helps you set goals and stay accountable. |
| 👂 **Listener** | Calm and empathetic. Just holds space for your thoughts and feelings. |
| 🥊 **Challenger** | Direct and probing. Questions your assumptions and pushes you to think deeper. |

---

## 🔐 Data Privacy

> **Your data never leaves your device.**

Drift is built on a **local-first** architecture:

- **All journal entries, mood logs, sessions, and streak data** are stored in your browser's IndexedDB via Dexie.js.
- **No data is sent to any server** — not even to us.
- **No user accounts, no tracking, no analytics.**
- **AI features** send only the current entry text to OpenRouter for processing. Your full journal history is never transmitted.
- **Data export** lets you download everything as JSON for backup or migration.

You are in full control of your data at all times.

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug report, feature request, or pull request — we'd love your help.

### How to Contribute

1. **Fork** the repository.
2. **Create a branch** for your feature or fix:

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** and ensure the app builds without errors:

   ```bash
   npm run build
   ```

4. **Commit** your changes with a clear message:

   ```bash
   git commit -m "feat: add new feature description"
   ```

5. **Push** to your fork and open a **Pull Request**.

### Guidelines

- Follow the existing code style (TypeScript, Tailwind CSS).
- Keep PRs focused — one feature or fix per PR.
- Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/).
- Test your changes on both mobile and desktop viewports.

### Reporting Issues

Open an issue on GitHub with:
- A clear title and description.
- Steps to reproduce (if applicable).
- Screenshots or screen recordings (if applicable).

---

## 📄 License

This project is licensed under the **MIT License**.

---

<p align="center">
  <strong>🌊 Drift — Journal freely. Reflect deeply. Stay private.</strong>
</p>
