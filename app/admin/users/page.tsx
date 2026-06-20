'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../../lib/context/UserContext'
import { supabase } from '../../../lib/supabase'

interface UserWithStats {
  id: string
  email: string
  name: string
  role: string
  total_points: number
  is_active: boolean
  created_at: string
  taskCount?: number
  submissionCount?: number
}

export default function AdminUsersPage() {
  const { currentUser } = useUser()
  const [users, setUsers] = useState<UserWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    role: 'l1' as 'l1' | 'l2' | 'l3',
  })

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    loadUsers()
  }, [currentUser?.id])

  async function loadUsers() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('users')
        .select('*')
        .in('role', ['l1', 'l2', 'l3'])
        .order('role', { ascending: true })

      if (!data) return

      const enriched = await Promise.all(
        data.map(async user => {
          const { count: taskCount } = await supabase
            .from('task_enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)

          const { count: submissionCount } = await supabase
            .from('submissions')
            .select('*', { count: 'exact', head: true })
            .eq('builder_id', user.id)

          return { ...user, taskCount: taskCount ?? 0, submissionCount: submissionCount ?? 0 }
        })
      )

      setUsers(enriched)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddUser() {
    if (!newUser.name) return setMessage('Name is required')
    if (!newUser.email) return setMessage('Email is required')

    try {
      const { error } = await supabase
        .from('users')
        .insert({
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          total_points: 0,
          is_active: true,
        })
      if (error) throw error

      setMessage(`${newUser.name} added successfully`)
      setNewUser({ name: '', email: '', role: 'l1' })
      setShowAddForm(false)
      await loadUsers()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to add user')
    }
  }

  async function handleToggleActive(user: UserWithStats) {
    const action = user.is_active ? 'deactivate' : 'reactivate'
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: !user.is_active })
        .eq('id', user.id)
      if (error) throw error

      setMessage(`${user.name} ${action}d`)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : `Failed to ${action} user`)
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (currentUser.role !== 'admin') return <div className="p-8 text-red-500">Only admins can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  const roleColors: Record<string, string> = {
    l1: 'bg-gray-100 text-gray-600',
    l2: 'bg-blue-100 text-blue-700',
    l3: 'bg-purple-100 text-purple-700',
  }

  const activeUsers = users.filter(u => u.is_active)
  const inactiveUsers = users.filter(u => !u.is_active)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Developer Accounts</h1>
          <p className="text-gray-500 text-sm mt-1">{activeUsers.length} active · {inactiveUsers.length} inactive</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-gray-800 text-white text-sm rounded hover:bg-gray-900"
        >
          {showAddForm ? 'Cancel' : '+ Add Developer'}
        </button>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {/* Add Developer Form */}
      {showAddForm && (
        <div className="border border-dashed border-gray-300 rounded-lg p-4 mb-6 bg-white">
          <h3 className="font-medium text-sm mb-3">Add New Developer</h3>
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Full name *"
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              value={newUser.name}
              onChange={e => setNewUser({ ...newUser, name: e.target.value })}
            />
            <input
              type="email"
              placeholder="Email *"
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              value={newUser.email}
              onChange={e => setNewUser({ ...newUser, email: e.target.value })}
            />
            <select
              className="border border-gray-300 rounded px-3 py-2 text-sm"
              value={newUser.role}
              onChange={e => setNewUser({ ...newUser, role: e.target.value as 'l1' | 'l2' | 'l3' })}
            >
              <option value="l1">L1 — Beginner</option>
              <option value="l2">L2 — Experienced</option>
              <option value="l3">L3 — Lead</option>
            </select>
          </div>
          <button
            onClick={handleAddUser}
            className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Add Developer
          </button>
        </div>
      )}

      {/* Active Developers */}
      <h2 className="font-semibold text-base mb-3">Active Developers</h2>
      <div className="space-y-2 mb-8">
        {activeUsers.length === 0 && (
          <p className="text-gray-400 text-sm">No active developers.</p>
        )}
        {activeUsers.map(user => (
          <div key={user.id} className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <span className="font-medium text-sm">{user.name}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${roleColors[user.role]}`}>{user.role.toUpperCase()}</span>
              </div>
              <span className="text-xs text-gray-400">{user.email}</span>
              <div className="flex gap-3 text-xs text-gray-500">
                <span>{user.taskCount} tasks enrolled</span>
                <span>{user.submissionCount} submissions</span>
                <span className="text-blue-600 font-medium">{user.total_points} pts</span>
              </div>
            </div>
            <button
              onClick={() => handleToggleActive(user)}
              className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
            >
              Deactivate
            </button>
          </div>
        ))}
      </div>

      {/* Inactive Developers */}
      {inactiveUsers.length > 0 && (
        <>
          <h2 className="font-semibold text-base mb-3 text-gray-400">Inactive Developers</h2>
          <div className="space-y-2">
            {inactiveUsers.map(user => (
              <div key={user.id} className="border border-gray-100 rounded-lg px-4 py-3 bg-gray-50 flex items-center justify-between opacity-60">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="font-medium text-sm text-gray-500">{user.name}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded ${roleColors[user.role]}`}>{user.role.toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-gray-400">{user.email}</span>
                </div>
                <button
                  onClick={() => handleToggleActive(user)}
                  className="text-xs px-3 py-1.5 border border-green-200 text-green-600 rounded hover:bg-green-50"
                >
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
