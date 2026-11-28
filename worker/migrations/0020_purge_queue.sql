-- Static links whose edge copy still has to be purged. Replacing a main photo
-- rewrites its three keys in R2, but pictures.* keeps a 200 for 30 days
-- (Docs/cloudflare.md, section 3), so a purge that fails (Cloudflare said no,
-- or the purge secrets are missing) would leave the old photo, under the new
-- credit, on every page and app. chooseMain (src/publish.ts) queues the URLs
-- of a failed purge here and the cron retries them until Cloudflare accepts.
CREATE TABLE purge_queue (
  url TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

-- Main photos replaced before this queue existed may still be stale on the
-- edge (their purge was never checked): purge every live static link once.
-- Targets are station ids and compact EVSE codes, so they need no escaping.
INSERT OR IGNORE INTO purge_queue (url, queued_at)
  SELECT 'https://pictures.ocarroeletrico.com/' || target || suffix, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM selections, (SELECT '.jpg' AS suffix UNION ALL SELECT '.thumb.jpg' UNION ALL SELECT '.full.jpg')
   WHERE published_at IS NOT NULL AND lost_at IS NULL;
