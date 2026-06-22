'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../lib/context/UserContext'
import { getUsers } from '../lib/services/users'
import { User } from '../lib/types'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const roleLinks: Record<string, { href: string; label: string }[]> = {
  subscriber: [
    { href: '/dashboard', label: 'Home' },
    { href: '/intake', label: 'Request a Tool' },
    { href: '/profile', label: 'Profile' },
  ],
  l1: [
    { href: '/dashboard', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/tasks/submit', label: 'Submit' },
    { href: '/profile', label: 'Profile' },
  ],
  l2: [
    { href: '/dashboard', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/tasks/submit', label: 'Submit' },
    { href: '/review', label: 'Review' },
    { href: '/profile', label: 'Profile' },
  ],
  l3: [
    { href: '/dashboard', label: 'Home' },
    { href: '/projects', label: 'Projects' },
    { href: '/tasks/submit', label: 'Submit' },
    { href: '/review', label: 'Review' },
    { href: '/assembly', label: 'Assembly' },
    { href: '/profile', label: 'Profile' },
  ],
  admin: [
    { href: '/dashboard', label: 'Home' },
    { href: '/admin', label: 'Manage' },
    { href: '/admin/review', label: 'Review' },
    { href: '/admin/users', label: 'Users' },
    { href: '/profile', label: 'Profile' },
  ],
}

export default function Navbar() {
  const { currentUser, setCurrentUser } = useUser()
  const [users, setUsers] = useState<User[]>([])
  const pathname = usePathname()

  useEffect(() => {
    getUsers().then(setUsers).catch(console.error)
  }, [])

  const links = currentUser ? (roleLinks[currentUser.role] ?? []) : []

  return (
    <nav className="w-full border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-bold text-lg tracking-tight text-gray-900 hover:text-blue-600">
          Check & Build
        </Link>
        <div className="flex items-center gap-1">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                pathname === link.href
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Switch user:</span>
        <select
          className="text-sm border border-gray-300 rounded px-2 py-1"
          value={currentUser?.id ?? ''}
          onChange={e => {
            const user = users.find(u => u.id === e.target.value) ?? null
            setCurrentUser(user)
          }}
        >
          <option value=''>-- select --</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role})
            </option>
          ))}
        </select>
        {currentUser && (
          <span className="text-sm font-medium text-blue-600">
            {currentUser.total_points} pts
          </span>
        )}
      </div>
    </nav>
  )
}
