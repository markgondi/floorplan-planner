# Floorplan Furniture Planner

Trace a floorplan to exact real-world dimensions, calibrate scale, and place furniture over it —
rendered in a CAD/architectural-drawing style (tan/charcoal palette).

## Status

Working local prototype: room creation, outline tracing with wall-length labels, scale
calibration, furniture placement/rotate/resize, units toggle (cm/in), print/PDF export view,
light/dark theme, logo slot in the header. State is currently in-memory only (resets on reload).

## Next steps (not yet wired up)

1. **Turso**: create a database, copy `.env.example` to `.env` and fill in
   `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`. Run `db/schema.sql` against it:
   ```bash
   turso db shell <db-name> < db/schema.sql
   ```
2. **API**: `api/rooms.ts` is written for Vercel serverless functions (`@vercel/node` +
   `@libsql/client`). Install those two packages, then deploy to Vercel (or adapt the handler
   signature for Netlify Functions) so `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` stay server-side.
3. **Wire the frontend to the API**: `src/lib/api.ts` already has `listRooms`/`getRoom`/
   `saveRoom`/`createRoom` calling `/api/rooms`. Swap `App.tsx`'s in-memory `useState` for these
   calls (load on mount, save on change) once the API is deployed.
4. **Floorplan image upload**: Turso doesn't store blobs — add an upload step (Vercel Blob,
   Cloudinary, etc.) and save the returned URL to `rooms.floorplan_image_url`.
5. **Logo**: drop your MQ logo file in `src/assets/` and swap it into
   `src/components/Header.tsx` (currently a placeholder box).
6. **Read-only vs editable stakeholder access**: decide before deploying publicly — currently
   the API has no auth, so anyone with the URL can write.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project structure

```
src/
  components/     FloorplanCanvas, RoomList, FurniturePanel, Header, UnitsToggle, PrintView
  lib/            geometry.ts, units.ts, api.ts, types.ts
  styles/theme.css  tan/charcoal design tokens, light + dark
api/rooms.ts      Turso-backed serverless CRUD endpoint (Vercel format)
db/schema.sql     rooms + furniture tables
```
