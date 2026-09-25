export default function App() {
  return <iframe srcDoc="<script>parent.postMessage({ type: 'x' }, '*')</script>" />
}
