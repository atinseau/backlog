import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
// Side-effect import: applies the persisted theme (or auto follows
// the OS) to <html data-theme=…> before anything renders, so the
// first paint already matches the user's choice.
import "./lib/theme.svelte.js";

const target = document.getElementById("app");
if (!target) {
  throw new Error("#app root not found");
}

mount(App, { target });
