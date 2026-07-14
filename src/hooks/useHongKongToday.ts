import { useEffect, useState } from 'react'
import {
  currentHongKongDate,
  millisecondsUntilNextHongKongDay,
} from '../lib/date'

export function useHongKongToday() {
  const [today, setToday] = useState(() => currentHongKongDate().date)

  useEffect(() => {
    let timeout = 0

    const synchronize = () => {
      const now = new Date()
      setToday(currentHongKongDate(now).date)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(synchronize, millisecondsUntilNextHongKongDay(now) + 50)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') synchronize()
    }

    synchronize()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return today
}
