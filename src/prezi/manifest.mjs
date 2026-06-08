// manifest.json builder (spec §2/§10). A SUPERSET of the #1 stub manifest — same required fields
// (schemaVersion, generator, generatedAt, presentationId, title, slug, entry, artifacts) plus the
// #3 metadata: render dimensions, scene/stop counts, citations[], and the quality report (§5.2).
// Keeping schemaVersion=1 means the #1 publish path serves these artifacts unchanged.

export const SCHEMA_VERSION = 1;
export const GENERATOR = 'prezi@1';

export function buildManifest({ id, title, slug, ir, artifacts, quality, fonts }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    generatedAt: new Date().toISOString(),
    presentationId: id,
    title,
    slug,
    entry: 'index.html',
    artifacts: [...artifacts].sort(),
    dimensions: { width: ir.canvas.width, height: ir.canvas.height },
    sceneCount: ir.scenes.length,
    stopCount: ir.tour.length,
    citations: (ir.citations || []).map((c) => ({ id: c.id, title: c.title, year: c.year ?? null, doi: c.doi || '', url: c.url || '' })),
    fonts: fonts || { embedded: false, note: 'system fallback stack; embed self-hosted fonts to guarantee sandbox↔viewer fidelity (§7.1)' },
    quality,
  };
}
