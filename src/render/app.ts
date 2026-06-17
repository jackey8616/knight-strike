import { Application, TextureSource } from "pixi.js";

export const BACKGROUND_COLOR = 0x1a1a1a;

export type RenderApp = {
  readonly app: Application;
  destroy(): void;
};

// PRD §5.1: pixel-art style requires NEAREST scale mode and `roundPixels` so
// integer-scaled sprites stay crisp; setting the TextureSource default before
// any textures load makes every subsequent texture pick this up implicitly.
export async function createRenderApp(
  container: HTMLElement,
): Promise<RenderApp> {
  TextureSource.defaultOptions.scaleMode = "nearest";

  const app = new Application();
  await app.init({
    background: BACKGROUND_COLOR,
    resizeTo: container,
    antialias: false,
    roundPixels: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
  });

  // Let the game own all touch gestures (pinch-zoom / pan / drag-dispatch)
  // instead of the browser scrolling or page-zooming the canvas away.
  app.canvas.style.touchAction = "none";

  container.appendChild(app.canvas);

  return {
    app,
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
