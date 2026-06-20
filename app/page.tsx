'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function Home() {
  const router = useRouter()
  const [role, setRole] = useState('')

  function handleEnter() {
    if (!role) return
    router.push('/dashboard')
  }

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] text-center px-8">
      <h1 className="text-3xl font-bold mb-3">Check & Build</h1>
      <p className="text-gray-500 max-w-md mb-8">
        A collaborative platform for Checkit Analytics subscribers to request custom financial tools,
        and for developers to build, review, and deliver them.
      </p>
      <div className="flex gap-3 items-center">
        <select
          className="border border-gray-300 rounded-lg px-4 py-2.5 text-sm w-48"
          value={role}
          onChange={e => setRole(e.target.value)}
        >
          <option value="">I am a...</option>
          <option value="subscriber">Subscriber</option>
          <option value="developer">Developer</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={handleEnter}
          disabled={!role}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Enter
        </button>
      </div>
    </div>
  )
}