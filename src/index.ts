import { Hono } from "hono";
import { cors } from "hono/cors";
import { poweredBy } from "hono/powered-by";
import * as auth from "./authorization";
import { Pattern, Playlist, User } from "./types";
import { Buffer } from "node:buffer";

type AppEnv = {
  bucket: R2Bucket;
  database: D1Database;
  secretKey: string;
};

const app = new Hono<{ Bindings: AppEnv }>();

app.use("*", cors(), poweredBy());

app.get("/playlists", auth.authMiddleware(), async (c) => {
  const stmt = c.env.database.prepare("SELECT * FROM playlists");
  let { results }: { results: Playlist[] } = await stmt.all();
  results = results.map((playlist) => {
    playlist.patterns = JSON.parse(playlist.patterns as unknown as string);
    return playlist;
  });
  return c.json(results);
});

app.get("/patterns", auth.authMiddleware(), async (c) => {
  const stmt = c.env.database.prepare("SELECT * FROM patterns");
  let { results }: { results: Pattern[] } = await stmt.all();
  return c.json(results);
});

app.get("/playlists/:uuid", auth.authMiddleware(), async (c) => {
  const playlistUUID = c.req.param("uuid");

  const stmt = c.env.database
    .prepare("SELECT * FROM playlists WHERE uuid=?")
    .bind(playlistUUID);
  let playlist: Playlist | null = await stmt.first();

  if (!playlist) {
    return c.text(`Playlist ${playlistUUID} does not exist!`, 404);
  }
  playlist.patterns = JSON.parse(playlist.patterns as unknown as string);

  c.header("Cache-Control", "max-age=31536000");
  return c.json(playlist);
});

app.get("/patterns/:uuid", auth.authMiddleware(), async (c) => {
  const patternUUID = c.req.param("uuid");

  const stmt = c.env.database
    .prepare("SELECT * FROM patterns WHERE uuid=?")
    .bind(patternUUID);
  let pattern: Pattern | null = await stmt.first();

  if (!pattern) {
    return c.text(`Pattern ${patternUUID} does not exist!`, 404);
  }

  c.header("Cache-Control", "max-age=31536000");
  return c.json(pattern);
});

app.get("/patterns/:uuid/data", auth.authMiddleware(), async (c) => {
  const pattern_uuid = c.req.param("uuid");
  const objectName = `patterns/${pattern_uuid}`;
  const object = await c.env.bucket.get(objectName);
  if (object === null) {
    return c.json({ error: "Not Found" }, 404);
  }

  const objectContent = await object.text();
  c.header("Content-Type", "text/plain");
  c.header("Cache-Control", "max-age=31536000");

  return c.body(objectContent);
});

app.get("/patterns/:uuid/thumb.png", auth.authMiddleware(), async (c) => {
  const pattern_uuid = c.req.param("uuid");
  const objectName = `patterns/thumbs/${pattern_uuid}.png`;
  const object = await c.env.bucket.get(objectName);
  if (object === null) {
    return c.json({ error: "Not Found" }, 404);
  }

  const objectContent = await object.arrayBuffer();
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "max-age=31536000");

  return c.body(objectContent);
});

app.post("/playlists", auth.authMiddleware(), async (c) => {
  const tokenPayload = auth.getPayload(c);

  if (!tokenPayload.user.is_admin) {
    return c.json({ error: "User not admin!" }, 403);
  }

  if (!tokenPayload.user.is_active) {
    return c.json({ error: "User not active!" }, 403);
  }

  const newPlaylist = await c.req.json<Playlist>();
  newPlaylist.uuid = newPlaylist.uuid.toLowerCase();

  const stmt = c.env.database
    .prepare(
      "INSERT INTO playlists (uuid,name,description,date,featured_pattern,patterns) VALUES (?,?,?,?,?,?)"
    )
    .bind(
      newPlaylist.uuid,
      newPlaylist.name,
      newPlaylist.description,
      newPlaylist.date,
      newPlaylist.featured_pattern,
      JSON.stringify(newPlaylist.patterns)
    );

  try {
    const results = await stmt.run();
    return c.json({ uuid: newPlaylist.uuid, meta: results.meta });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.post("/patterns", auth.authMiddleware(), async (c) => {
  interface PostPatternBody {
    patternData: string;
    pattern: Pattern;
    thumbData: string;
  }

  const tokenPayload = auth.getPayload(c);
  if (!tokenPayload.user.is_admin) {
    return c.json({ error: "User not admin!" }, 403);
  }

  if (!tokenPayload.user.is_active) {
    return c.json({ error: "User not active!" }, 403);
  }

  const newPatternBody = await c.req.json<PostPatternBody>();
  newPatternBody.pattern.uuid = newPatternBody.pattern.uuid.toLowerCase();

  try {
    const objectName = `patterns/${newPatternBody.pattern.uuid}`;
    await c.env.bucket.put(objectName, newPatternBody.patternData);
  } catch (e) {
    return c.json({ error: "Couldn't store pattern!" }, 500);
  }

  try {
    const objectName = `patterns/thumbs/${newPatternBody.pattern.uuid}.png`;
    const buf = Buffer.from(newPatternBody.thumbData, "base64");
    await c.env.bucket.put(objectName, buf);
  } catch (e) {
    return c.json({ error: "Couldn't store pattern thumbnail!" }, 500);
  }

  const newPattern = newPatternBody.pattern;

  const stmt = c.env.database
    .prepare(
      "INSERT INTO patterns (name,uuid,popularity,date,creator) VALUES (?,?,?,?,?)"
    )
    .bind(
      newPattern.name,
      newPattern.uuid,
      newPattern.popularity,
      newPattern.date,
      newPattern.creator
    );

  try {
    const results = await stmt.run();
    return c.json({ uuid: newPattern.uuid, meta: results.meta });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.post("/auth", async (c) => {
  interface AuthRequestBody {
    email: string;
    password: string;
  }

  const body = await c.req.json<AuthRequestBody>();

  if (!body.email || !body.password) {
    return c.json({ error: "Malformed request" }, 400);
  }

  const stmt = c.env.database
    .prepare("SELECT * FROM users WHERE email=? AND password=?")
    .bind(body.email, body.password);
  let user: User | null = await stmt.first();

  if (!user) {
    return c.text(`Invalid email or password`, 401);
  }

  const tokenPayload = {
    user: user,
  };

  const token = await auth.generateToken(tokenPayload, c.env.secretKey, "10y");

  return c.json({
    token,
  });
});

app.notFound((c) => {
  return c.redirect("https://www.youtube.com/watch?v=FfnQemkjPjM", 302);
});

app.onError((err, c) => {
  console.error(err);
  return c.text(
    "Whoops! An unhandled exception occured. We'll be looking into this issue!",
    500
  );
});

export default app;
