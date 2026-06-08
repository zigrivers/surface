import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type BrowserQaSeededApp = {
  readonly close: () => Promise<void>;
  readonly url: string;
};

export async function startBrowserQaSeededApp(): Promise<BrowserQaSeededApp> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/api/network-failure") {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "seeded_network_failure" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(pageForPath(url.pathname));
  });

  await listen(server);
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Seeded browser QA fixture did not bind to a TCP port.");
  }

  return {
    close: () => close(server),
    url: `http://127.0.0.1:${address.port}`,
  };
}

function pageForPath(pathname: string): string {
  switch (pathname) {
    case "/cart":
      return layout("Cart", `<button type="button" onclick="location.href='/checkout'">Checkout</button>`);
    case "/checkout":
      return layout(
        "Checkout",
        `<label>Email <input aria-label="Email" name="email" type="email"></label>
         <label>Card number <input aria-label="Card number" name="card"></label>
         <button type="button" onclick="document.querySelector('#checkout-error').hidden = false">Pay now</button>
         <p id="checkout-error" hidden>Card number is required</p>`,
      );
    case "/settings/profile":
      return layout(
        "Settings",
        `<form>
           <label>Profile name <input aria-label="Profile name" name="profileName" value="Seed User"></label>
           <button type="button" onclick="document.querySelector('#settings-status').textContent = 'Profile saved'">Save profile</button>
           <p id="settings-status" aria-live="polite"></p>
         </form>`,
      );
    case "/billing":
      return layout(
        "Billing",
        `<button type="button">Delete account</button>
         <button type="button">Pay now</button>
         <p>Billing actions are intentionally policy-denied by default.</p>`,
      );
    case "/console-error":
      return layout(
        "Console Error",
        `<script>console.error("seeded console error");</script><p>Console error emitted.</p>`,
      );
    case "/network-failure":
      return layout(
        "Network Failure",
        `<script>fetch("/api/network-failure").catch(() => undefined);</script><p>Network failure requested.</p>`,
      );
    case "/modal":
      return layout(
        "Modal",
        `<button type="button" onclick="document.querySelector('dialog').showModal()">Open modal</button>
         <dialog aria-label="Seeded modal"><p>Seeded modal content</p><button onclick="this.closest('dialog').close()">Close</button></dialog>`,
      );
    case "/iframe":
      return layout(
        "Iframe",
        `<iframe title="Payment frame" srcdoc="<label>Frame card <input aria-label='Frame card'></label>"></iframe>`,
      );
    case "/auth-drift":
      return layout("Auth Drift", `<p role="status">Signed out: fixture auth drift state</p>`);
    default:
      return layout(
        "Browser QA Fixture",
        `<nav>
           <a href="/cart">Cart</a>
           <a href="/settings/profile">Settings</a>
           <a href="/billing">Billing</a>
           <a href="/console-error">Console</a>
           <a href="/network-failure">Network</a>
           <a href="/modal">Modal</a>
           <a href="/iframe">Iframe</a>
           <a href="/auth-drift">Auth drift</a>
         </nav>`,
      );
  }
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      button, input { font: inherit; margin: 0.25rem; }
      iframe { border: 1px solid #94a3b8; min-height: 8rem; width: 28rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
