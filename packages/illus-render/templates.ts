// Public template-only entry. Keep this physical root shim for Flow's moduleResolution: node;
// exports-aware consumers resolve the same file through package.json.
// Importing the renderer barrel here would load browser engines in the LLM server.
export * from './src/templates/index.ts'
