import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { builtinModules, createRequire } from 'node:module';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type RenderStage = 'load-renderer' | 'parse-pdf' | 'render-page';

export class PdfRendererError extends Error {
  readonly code: 'RENDERER_INITIALIZATION_FAILED' | 'PDF_RENDER_FAILED';

  constructor(
    readonly stage: RenderStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PdfRendererError';
    this.code = stage === 'load-renderer' ? 'RENDERER_INITIALIZATION_FAILED' : 'PDF_RENDER_FAILED';
  }
}

export type PdfToPngOptions = {
  viewportScale?: number;
  pagesToProcess?: number[];
  returnMetadataOnly?: boolean;
};

export type PngPageOutput = {
  pageNumber: number;
  name: string;
  content: Buffer;
  path: string;
  width: number;
  height: number;
};

function installPdfJsCanvasGlobals() {
  const global = globalThis as Record<string, unknown>;

  global.DOMMatrix ??= DOMMatrix;
  global.ImageData ??= ImageData;
  global.Path2D ??= Path2D;

  // PDF.js 4 advertises Node >=20, but its NodeCanvasFactory uses the
  // process.getBuiltinModule API that was only added in Node 20.19. Supply the
  // equivalent operation on earlier Node 20 releases before importing PDF.js.
  const nodeProcess = process as NodeJS.Process & {
    getBuiltinModule?: (id: string) => unknown;
  };
  if (!nodeProcess.getBuiltinModule) {
    const require = createRequire(import.meta.url);
    const allowed = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    nodeProcess.getBuiltinModule = (id: string) => {
      if (!allowed.has(id)) throw new Error(`Not a built-in Node module: ${id}`);
      return require(id);
    };
  }
}

let pdfJsImport: Promise<PdfJs> | undefined;

export async function initializePdfRenderer(): Promise<PdfJs> {
  installPdfJsCanvasGlobals();
  pdfJsImport ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    return await pdfJsImport;
  } catch (cause) {
    pdfJsImport = undefined;
    throw rendererError('load-renderer', cause);
  }
}

function rendererError(stage: RenderStage, cause: unknown, pageNumber?: number): PdfRendererError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const page = pageNumber === undefined ? '' : ` (page ${pageNumber})`;
  const error = new PdfRendererError(stage, `PDF renderer failed during ${stage}${page}: ${detail}`, { cause });
  console.error('[pdf-renderer]', {
    stage,
    pageNumber,
    name: cause instanceof Error ? cause.name : typeof cause,
    message: detail,
    stack: cause instanceof Error ? cause.stack : undefined,
    cause: cause instanceof Error ? cause.cause : undefined,
  });
  return error;
}

function pdfData(pdfFile: string | ArrayBufferLike | Uint8Array): string | Uint8Array {
  if (typeof pdfFile === 'string') return pdfFile;
  if (pdfFile instanceof Uint8Array) return Uint8Array.from(pdfFile);
  return new Uint8Array(pdfFile);
}

export async function pdfToPng(
  pdfFile: string | ArrayBufferLike | Uint8Array,
  options: PdfToPngOptions = {},
): Promise<PngPageOutput[]> {
  const { getDocument } = await initializePdfRenderer();
  let document;
  try {
    document = await getDocument({ data: pdfData(pdfFile), useSystemFonts: true }).promise;
  } catch (cause) {
    throw rendererError('parse-pdf', cause);
  }

  try {
    const requestedPages = options.pagesToProcess ?? Array.from({ length: document.numPages }, (_, index) => index + 1);
    const pageNumbers = requestedPages.filter((page) => Number.isInteger(page) && page >= 1 && page <= document.numPages);
    const output: PngPageOutput[] = [];

    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: options.viewportScale ?? 1 });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      let content: Buffer = Buffer.alloc(0);

      if (!options.returnMetadataOnly) {
        try {
          const canvas = createCanvas(width, height);
          const canvasContext = canvas.getContext('2d');
          await page.render({ canvasContext: canvasContext as never, viewport }).promise;
          content = canvas.toBuffer('image/png');
        } catch (cause) {
          throw rendererError('render-page', cause, pageNumber);
        }
      }

      output.push({ pageNumber, name: `page-${pageNumber}.png`, content, path: '', width, height });
      page.cleanup();
    }

    return output;
  } finally {
    await document.destroy();
  }
}
