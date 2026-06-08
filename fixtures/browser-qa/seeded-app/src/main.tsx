import { seededBrowserQaRoutes } from "./App.js";

export function renderSeededBrowserQaRouteList(): string {
  return seededBrowserQaRoutes.map((route) => `<li><a href="${route}">${route}</a></li>`).join("");
}
