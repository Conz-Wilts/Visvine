const STRIPE = '__STRIPE_LIVE__'
const AWS = '__AWS_KEY__'
export default function App() {
  return <p>{STRIPE.length + AWS.length}</p>
}
