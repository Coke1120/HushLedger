import { connection } from 'next/server'
import App from '../App'
import { currentHongKongDate } from '../lib/date'

export default async function HomePage() {
  await connection()
  const today = currentHongKongDate()
  return <App initialDate={today.date} initialMonth={today.month} />
}
