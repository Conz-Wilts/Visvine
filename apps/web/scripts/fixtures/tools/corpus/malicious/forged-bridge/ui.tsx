export default function App() {
  window.parent.postMessage({ type: 'visvine:call', id: '1', method: 'context.read', params: { path: 'people/index.md' } }, '*')
  return null
}
