export const INSPECTOR_CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; color: #1c1008; font: 600 12px/1.35 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
button, input, select { font: inherit; }
button { margin: 0; border: 0; color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #fff; box-shadow: 0 0 0 5px #1c1008; }
.stage { position: relative; width: 220px; height: 348px; user-select: none; touch-action: none; }
.robot { position: absolute; left: 16px; top: 16px; width: 188px; height: 316px; }
.asset { position: absolute; inset: 0 auto auto 0; display: block; width: 188px; height: 264px; object-fit: contain; pointer-events: none; }
.asset-pro { display: none; }
.robot[data-mode="pro"] .asset-lite { display: none; }
.robot[data-mode="pro"] .asset-pro { display: block; }
.drag-handle { position: absolute; left: 10px; top: 5px; width: 168px; height: 32px; cursor: grab; background: transparent; border-radius: 30px; }
.drag-handle:active { cursor: grabbing; }
.hotspot { position: absolute; display: grid; place-items: center; background: transparent; border-radius: 50%; }
.copy { left: 132px; top: 158px; width: 24px; height: 24px; }
.robot[data-copied="true"] .asset [id="Vector_9"] { fill: #42d47b; }
.asset [id^="Vector"], .asset [id="Group"] { transform-box: fill-box; transform-origin: center; }
.settings-button { left: 136px; top: 187px; width: 21px; height: 21px; }
.capture { left: 114px; top: 207px; width: 24px; height: 20px; border-radius: 6px; }
.download { left: 38px; top: 184px; width: 38px; height: 38px; border-radius: 6px; }
.gear { left: 101px; top: 174px; width: 27px; height: 26px; }
.inspector-close { position: absolute; right: -8px; top: -8px; width: 27px; height: 27px; border: 3px solid #1c1008; border-radius: 50%; background: #fffdf6; font-size: 18px; line-height: 18px; box-shadow: 2px 2px 0 rgb(28 16 8 / .2); }
.screen { position: absolute; left: 28px; top: 23px; width: 132px; height: 107px; padding: 14px 12px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; border-radius: 12px; background: transparent; cursor: pointer; }
.screen[data-content="true"] { background: #d4ede3; }
.robot[data-mode="pro"] .screen[data-content="true"] { background: #ffd1d9; }
.screen-status { max-width: 110px; font-size: 11px; font-weight: 800; }
.screen-match { margin-top: 2px; font-size: 9px; font-weight: 800; color: #126f60; }
.robot[data-mode="pro"] .screen-match { color: #a9002b; }
.screen-summary { max-width: 112px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; opacity: .72; }
.screen-count { position: absolute; right: 7px; top: 6px; min-width: 19px; padding: 2px 5px; color: white; background: #1c1008; border-radius: 10px; font-size: 9px; }
.screen-count:empty { display: none; }
.mode-picker { position: absolute; left: 0; right: 0; top: 272px; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.mode-switch { flex: none; position: relative; width: 44px; height: 22px; padding: 0; border: 0; box-shadow: inset 0 0 0 2.5px #1c1008; border-radius: 999px; background: #59ac9d; }
.mode-switch:focus-visible { outline: 2px dashed #1c1008; outline-offset: 3px; box-shadow: inset 0 0 0 2.5px #1c1008; }
.mode-switch::after { content: ""; position: absolute; left: 3.5px; top: 50%; width: 15px; height: 15px; border: 2px solid #1c1008; border-radius: 50%; background: white; transform: translateY(-50%); transition: transform .18s ease; }
.robot[data-mode="pro"] .mode-switch { background: #ff003f; }
.robot[data-mode="pro"] .mode-switch::after { transform: translate(22px, -50%); }
.mode-label { letter-spacing: .06em; font-size: 9px; line-height: 12px; font-weight: 800; }
.panel { position: fixed; width: min(340px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow: auto; padding: 16px; border: 5px solid #1c1008; border-radius: 22px; background: #fffdf6; box-shadow: 8px 9px 0 rgb(28 16 8 / .22); user-select: text; }
.panel[hidden] { display: none; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 15px; }
.panel-close { width: 28px; height: 28px; border: 3px solid #1c1008; border-radius: 50%; background: #ffcf27; }
.panel-close::before { content: "×"; font-size: 19px; line-height: 18px; }
.field { display: grid; grid-template-columns: 1fr 110px; align-items: center; gap: 8px; margin: 10px 0; }
.field input, .field select { min-width: 0; width: 100%; height: 32px; border: 3px solid #1c1008; border-radius: 9px; padding: 3px 7px; background: white; color: #1c1008; }
.panel-actions { display: grid; gap: 8px; }
.panel-action { min-height: 38px; padding: 7px 11px; border: 3px solid #1c1008; border-radius: 12px; background: #63c9b7; text-align: left; }
.panel-action.danger { background: #ff3d67; }
.preview { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.toast { position: absolute; right: 12px; bottom: 52px; max-width: 200px; padding: 8px 12px; border: 3px solid #1c1008; border-radius: 12px; background: #fff; box-shadow: 4px 4px 0 rgb(28 16 8 / .2); opacity: 0; transform: translateY(8px); transition: .16s ease; pointer-events: none; }
.toast[data-show="true"] { opacity: 1; transform: none; }
.highlight, .selection { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px dashed #00a88f; box-shadow: 0 0 0 2px white, 0 0 0 4px #1c1008; }
.highlight[data-selected="true"], .selection { border-style: solid; }
.highlight[hidden] { display: none; }
.highlight-label { position: absolute; left: -2px; bottom: calc(100% + 6px); max-width: min(320px, 90vw); padding: 4px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: white; background: #1c1008; border-radius: 6px; font: 600 11px/1.3 system-ui, sans-serif; }
.busy .asset { animation: sourcepin-pulse .75s ease-in-out infinite alternate; }
@keyframes sourcepin-pulse { to { opacity: .72; } }
@media (max-width: 600px) { .panel { z-index: 5; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`;
