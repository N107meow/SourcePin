export type Mode = 'lite' | 'pro';
export type Language = 'zh' | 'en';
export type Styles = Record<string, string>;
export interface Rect { x: number; y: number; width: number; height: number }
export interface Locator {
  kind: 'css' | 'xpath' | 'playwright'; value: string;
  stability: 'stable' | 'medium' | 'unstable'; matches: number | null;
  verified: boolean; note?: string;
}
export interface FrameworkInfo { framework: string; components: string[]; props: Record<string, string>; source?: string }
export interface NodeSnapshot {
  key: string; depth: number; tag: string; attributes: Record<string, string>; text: string;
  styles: Styles; rect: Rect; pseudo: Record<string, Styles>;
}
export interface Asset { kind: string; url: string; width?: number; height?: number }
export interface Capture {
  id: string; timestamp: string; mode: Mode;
  meta: { url: string; title: string; viewport: { width: number; height: number }; dpr: number; scroll: { x: number; y: number }; reach: string[] };
  target: { tag: string; text: string; attributes: Record<string, string>; ancestors: string[]; childIndex: number; typeIndex: number; siblingCount: number; rect: Rect; visible: boolean; inViewport: boolean };
  locators: Locator[]; nodes: NodeSnapshot[]; html: string; css: string;
  tokens: Record<string, string[]>; assets: Asset[]; animations: unknown[];
  framework?: FrameworkInfo; degradations: string[];
}
export interface CaptureOptions { mode: Mode; maxNodes?: number; maxDepth?: number; signal?: AbortSignal }
export interface RecordedState { id: string; name: string; at: number; styles: Styles; attributes: Record<string, string>; condition: string }
export interface Transition { from: string; to: string; event: string; target: string; styleDelta: Styles; changes: string[] }
export interface Recording { states: RecordedState[]; transitions: Transition[]; degradations: string[] }
export interface Recorder { stop(): Recording; snapshot(): Recording; dispose(): void }
export interface Settings { mode: Mode; language: Language; maxNodes: number; maxDepth: number; onboardingDone: boolean }
export const DEFAULT_SETTINGS: Settings = { mode: 'lite', language: 'zh', maxNodes: 300, maxDepth: 6, onboardingDone: false };
export interface Platform {
  kind: 'extension' | 'bookmarklet' | 'demo';
  loadSettings(): Promise<Settings>; saveSettings(settings: Settings): Promise<void>;
  copy(text: string): Promise<void>;
  download(text: string, filename: string): Promise<string>;
  screenshot?(rect?: Rect): Promise<string>;
  framework?(element: Element): Promise<FrameworkInfo | undefined>;
}
export interface UIState {
  mode: Mode; status: string; count: number; summary: string; copied: boolean;
  busy: boolean; recording: boolean; matched: boolean; markdown: string; settings: Settings;
}
export interface UIActions {
  copy(): void; download(): void; close(): void; repick(): void;
  settings(settings: Settings): void; record(): void; screenshot(component: boolean): void;
  wholePage(): void; addViewport(): void;
}
export interface InspectorUI {
  host: HTMLElement; update(state: UIState): void; toast(message: string): void;
  contains(event: Event): boolean; closePanel(): boolean; destroy(): void;
  highlight(rect: Rect | null, label?: string, selected?: boolean, color?: string): void;
  selections(rects: Rect[]): void; hide(hidden: boolean): void;
}
