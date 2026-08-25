import { connection } from 'next/server'
import App from '../App'
import { currentHongKongDate } from '../lib/date'
import { getCloudflareEnv } from '../server/db'

export default async function HomePage() {
  await connection()
  const today = currentHongKongDate()
  const publicDemo = (await getCloudflareEnv()).HUSHLEDGER_PUBLIC_DEMO === 'true'
  return <App initialDate={today.date} initialMonth={today.month} publicDemo={publicDemo} />
}
