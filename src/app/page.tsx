import { connection } from 'next/server'
import App from '../App'
import { currentHongKongDate } from '../lib/date'

export default async function HomePage() {
  await connection()
  return <App initialMonth={currentHongKongDate().month} />
}
