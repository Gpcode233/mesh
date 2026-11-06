"use client"

import { useEffect, useRef } from "react"
import gsap from "gsap"
import { ReactLenis, type LenisRef } from "lenis/react"

export function SmoothScrollProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const lenisRef = useRef<LenisRef>(null)

  useEffect(() => {
    const update = (time: number) => {
      lenisRef.current?.lenis?.raf(time * 1000)
    }

    gsap.ticker.add(update)
    gsap.ticker.lagSmoothing(0)
    const lenis = lenisRef.current?.lenis

    return () => {
      gsap.ticker.remove(update)
      lenis?.destroy()
    }
  }, [])

  return (
    <ReactLenis root ref={lenisRef} options={{ autoRaf: false, duration: 1.2 }}>
      {children}
    </ReactLenis>
  )
}
