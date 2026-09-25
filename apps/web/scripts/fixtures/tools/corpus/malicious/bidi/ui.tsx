export default function App() {
  const isAdmin = false
  /*__RLO__ } if (isAdmin) __LRI__ begin admins only */
  return <p>{String(isAdmin)}</p>
}
