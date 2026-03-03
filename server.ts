import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";

const db = new Database("golf_sessions.db");

// Initialize database table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    date TEXT,
    drill TEXT,
    data TEXT
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/sessions", (req, res) => {
    try {
      const stmt = db.prepare("SELECT * FROM sessions ORDER BY date ASC");
      const rows = stmt.all();
      const sessions = rows.map((row: any) => ({
        id: row.id,
        date: row.date,
        drill: row.drill,
        data: JSON.parse(row.data)
      }));
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", (req, res) => {
    try {
      const { id, date, drill, data } = req.body;
      const stmt = db.prepare("INSERT INTO sessions (id, date, drill, data) VALUES (?, ?, ?, ?)");
      stmt.run(id, date, drill, JSON.stringify(data));
      res.json({ success: true, id });
    } catch (error) {
      console.error("Error saving session:", error);
      res.status(500).json({ error: "Failed to save session" });
    }
  });

  // Vite middleware for development and serving static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("index.html", { root: "dist" });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
