import { Router, type IRouter } from "express";

/**
 * Deterministic fixture page used by the C# UX recorder tests
 * (memento-ux-tests/Memento.UxTests.Tests/Tests/RecorderTests.cs).
 *
 * The page is split into seven equal vertical bands using viewport
 * units so that coordinate-based clicks from the recorder canvas
 * deterministically hit the same target across viewport sizes:
 *
 *  Band 1 (~ 7%)  — heading
 *  Band 2 (~21%)  — single-line <input>          (#ux-input)
 *  Band 3 (~36%)  — <textarea>                    (#ux-textarea)
 *  Band 4 (~50%)  — contenteditable <div>         (#ux-contenteditable)
 *  Band 5 (~64%)  — <select> with three options   (#ux-select)
 *  Band 6 (~78%)  — checkbox                      (#ux-checkbox)
 *  Band 7 (~93%)  — <button>                      (#ux-button)
 *
 * Sits outside the auth-protected sub-router so the embedded
 * recorder browser can reach it without holding a session cookie.
 */
const router: IRouter = Router();

router.get("/ux-fixture", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>UX Recorder Fixture</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: system-ui, sans-serif;
    display: flex; flex-direction: column;
  }
  .band {
    flex: 1 1 0; display: flex; align-items: center; justify-content: center;
    border-bottom: 1px solid #ddd; padding: 0 24px;
  }
  .band > * {
    width: 80%; max-width: 600px; box-sizing: border-box;
    padding: 8px; font: inherit; border: 1px solid #999; border-radius: 4px;
  }
  .band h1 { border: none; text-align: center; }
  textarea { height: 100%; min-height: 40px; resize: none; }
  [contenteditable] { background: #fff; min-height: 40px; }
  button { cursor: pointer; }
  .band.checkbox { padding: 0; }
  .band.checkbox label {
    width: auto; padding: 8px 16px; border: 1px solid #999; border-radius: 4px;
    display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  }
  .band.checkbox input { margin: 0; transform: scale(1.4); }
</style></head>
<body>
  <div class="band"><h1 id="ux-heading">UX Recorder Fixture</h1></div>
  <div class="band">
    <input id="ux-input" name="ux-input" type="text"
           aria-label="Single line input" placeholder="single-line input" />
  </div>
  <div class="band">
    <textarea id="ux-textarea" name="ux-textarea"
              aria-label="Textarea" placeholder="textarea"></textarea>
  </div>
  <div class="band">
    <div id="ux-contenteditable" contenteditable="true"
         role="textbox" aria-label="Contenteditable">
      contenteditable
    </div>
  </div>
  <div class="band">
    <select id="ux-select" name="ux-select" aria-label="Select">
      <option value="alpha">Alpha</option>
      <option value="beta">Beta</option>
      <option value="gamma">Gamma</option>
    </select>
  </div>
  <div class="band checkbox">
    <label>
      <input id="ux-checkbox" name="ux-checkbox" type="checkbox" />
      Checkbox
    </label>
  </div>
  <div class="band">
    <button id="ux-button" type="button">Click me</button>
  </div>
</body></html>`);
});

export default router;
