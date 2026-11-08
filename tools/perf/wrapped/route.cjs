// Serve a worktree's build dir as http://localhost:3001 inside a playwright context, so IndexedDB (per origin) is shared between builds
const fs = require("node:fs");
const path = require("node:path");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".gif": "image/gif", ".map": "application/json" };
const STATIC = ["/css/", "/files/", "/fonts/", "/gen/", "/ico/", "/img/", "/manifest"];
exports.install = async (ctx, buildDir, origin = "http://localhost:3001") => {
	await ctx.route(origin + "/**", async (route) => {
		const u = new URL(route.request().url());
		const isStatic = STATIC.some((p) => u.pathname.startsWith(p));
		const file = path.join(buildDir, isStatic ? u.pathname : "index.html");
		try {
			let body = fs.readFileSync(file);
			// A dedicated worker, so playwright can see it
			if (!isStatic) {body = Buffer.from(body.toString().replace('"undefined"!=typeof SharedWorker', "false").replace('typeof SharedWorker !== "undefined"', "false"));}
			await route.fulfill({ status: 200, body, headers: { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" } });
		} catch {
			await route.fulfill({ status: 404, body: "not found" });
		}
	});
};
