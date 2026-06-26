'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { Project, Task, PointTransaction } from '../../lib/types'
import Link from 'next/link'

const statusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  in_review: 'bg-yellow-100 text-yellow-700',
  ready_for_admin: 'bg-teal-100 text-teal-700',
  pending_deployment: 'bg-purple-100 text-purple-700',
  finished: 'bg-green-100 text-green-700',
}

const taskStatusColors: Record<string, string> = {
  open: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  submitted: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
}

function QuickLink({ href, label, color = 'blue' }: { href: string; label: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    green: 'bg-green-600 hover:bg-green-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
    purple: 'bg-purple-600 hover:bg-purple-700',
  }
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-white text-sm rounded-lg font-medium ${colors[color] ?? colors.blue}`}
    >
      {label}
    </Link>
  )
}

function StatCard({ label, value, color = 'blue' }: { label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    amber: 'text-amber-500',
    purple: 'text-purple-600',
    gray: 'text-gray-600',
  }
  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4 text-center">
      <div className={`text-3xl font-bold ${colors[color]}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  )
}

export default function DashboardPage() {
  const { currentUser } = useUser()
  const [loading, setLoading] = useState(true)
  const [openMessageProjectId, setOpenMessageProjectId] = useState<string | null>(null)
  const [projectMessages, setProjectMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')

  const [myProjects, setMyProjects] = useState<(Project & { main_contact_name?: string })[]>([])
  const [myTasks, setMyTasks] = useState<(Task & { project_title?: string })[]>([])
  const [transactions, setTransactions] = useState<PointTransaction[]>([])
  const [platformStats, setPlatformStats] = useState({
    totalProjects: 0,
    activeProjects: 0,
    pendingProjects: 0,
    totalTasks: 0,
    pendingSubmissions: 0,
  })
  const [recentProjects, setRecentProjects] = useState<Project[]>([])

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    setMyProjects([])
    setMyTasks([])
    setTransactions([])
    loadData()
  }, [currentUser])

  async function loadData() {
    if (!currentUser) return
    setLoading(true)

    try {
      if (currentUser.role === 'subscriber') {
        const { data: projects } = await supabase
          .from('projects')
          .select('*')
          .eq('subscriber_id', currentUser.id)
          .order('created_at', { ascending: false })

        if (projects) {
          const enriched = await Promise.all(
            projects.map(async p => {
              if (!p.main_contact_id) return { ...p, main_contact_name: undefined }
              const { data: user } = await supabase
                .from('users')
                .select('name')
                .eq('id', p.main_contact_id)
                .single()
              return { ...p, main_contact_name: user?.name }
            })
          )
          setMyProjects(enriched)
        }
      }

      if (['l1', 'l2', 'l3'].includes(currentUser.role)) {
        const { data: enrollments } = await supabase
          .from('task_enrollments')
          .select('task_id')
          .eq('user_id', currentUser.id)

        if (enrollments && enrollments.length > 0) {
          const taskIds = enrollments.map(e => e.task_id)
          const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .in('id', taskIds)

          if (tasks) {
            const enriched = await Promise.all(
              tasks.map(async t => {
                const { data: project } = await supabase
                  .from('projects')
                  .select('title')
                  .eq('id', t.project_id)
                  .single()
                return { ...t, project_title: project?.title }
              })
            )
            setMyTasks(enriched)
          }
        }

        const { data: txns } = await supabase
          .from('point_transactions')
          .select('*')
          .eq('user_id', currentUser.id)
        setTransactions(txns ?? [])
      }

      if (currentUser.role === 'admin') {
        const { data: allProjects } = await supabase.from('projects').select('*')
        const { data: allTasks } = await supabase.from('tasks').select('id')
        const { data: pendingSubs } = await supabase
          .from('submissions')
          .select('id')
          .eq('status', 'pending')

        if (allProjects) {
          setPlatformStats({
            totalProjects: allProjects.length,
            activeProjects: allProjects.filter(p => p.status === 'active').length,
            pendingProjects: allProjects.filter(p => p.status === 'pending').length,
            totalTasks: allTasks?.length ?? 0,
            pendingSubmissions: pendingSubs?.length ?? 0,
          })
          setRecentProjects(
            [...allProjects]
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .slice(0, 5)
          )
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadProjectMessages(projectId: string) {
    const { data: messages } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    const withNames = await Promise.all(
      (messages ?? []).map(async (msg: any) => {
        const { data: sender } = await supabase
          .from('users').select('name').eq('id', msg.sender_id).single()
        return { ...msg, sender_name: sender?.name }
      })
    )
    setProjectMessages(withNames)
  }

  async function handleSendMessage(projectId: string) {
    if (!currentUser || !newMessage.trim()) return
    try {
      await supabase.from('project_messages').insert({
        project_id: projectId,
        sender_id: currentUser.id,
        message: newMessage.trim(),
      })
      setNewMessage('')
      await loadProjectMessages(projectId)
    } catch (e) {
      console.error(e)
    }
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] text-center">
        <p className="text-gray-500 text-lg">Please select a user to view your dashboard.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="p-8 text-gray-500">Loading...</div>
  }

  const earnedPoints = transactions.filter(t => t.status === 'earned').reduce((s, t) => s + t.amount, 0)
  const pendingPoints = transactions.filter(t => t.status === 'pending').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="p-8 max-w-5xl mx-auto">

      <div className="mb-8">
        <h1 className="text-2xl font-bold">Welcome, {currentUser.name}</h1>
        <p className="text-gray-500 text-sm mt-1">{currentUser.role.toUpperCase()}</p>
      </div>

      {/* SUBSCRIBER */}
      {currentUser.role === 'subscriber' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">My Projects</h2>
            <QuickLink href="/intake" label="+ Request a New Tool" color="green" />
          </div>
          {myProjects.length === 0 ? (
            <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center">
              <p className="text-gray-500 mb-4">No projects yet.</p>
              <QuickLink href="/intake" label="Request Your First Tool" color="blue" />
            </div>
          ) : (
            <div className="space-y-3">
              {myProjects.map(p => (
                <div key={p.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-800">{p.title}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{p.description}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0 ml-4">
                      <span className={`text-xs px-2 py-1 rounded ${statusColors[p.status]}`}>{p.status}</span>
                      <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">{p.priority}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-gray-400">
                    <span>Main Contact: {p.main_contact_name ?? 'Not assigned yet'}</span>
                    <span>Submitted: {new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  {p.status === 'finished' && (
                    <a
                      href={`/archive/${p.id}`}
                      className="text-xs text-teal-600 hover:underline mt-1 block"
                    >
                      View Archive →
                    </a>
                  )}
                  <div className="mt-2">
                    <button
                      onClick={() => {
                        if (openMessageProjectId === p.id) {
                          setOpenMessageProjectId(null)
                        } else {
                          setOpenMessageProjectId(p.id)
                          loadProjectMessages(p.id)
                        }
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {openMessageProjectId === p.id ? 'Hide Messages' : 'Messages'}
                    </button>

                    {openMessageProjectId === p.id && (
                      <div className="mt-2 border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="space-y-2 mb-2 max-h-40 overflow-auto">
                          {projectMessages.length === 0 && (
                            <p className="text-xs text-gray-400 italic">No messages yet.</p>
                          )}
                          {projectMessages.map((msg: any) => (
                            <div key={msg.id} className="text-xs border border-gray-100 rounded p-2 bg-white">
                              <div className="text-gray-500 mb-0.5">
                                {msg.sender_name ?? 'Unknown'} · {new Date(msg.created_at).toLocaleString()}
                              </div>
                              <div className="text-gray-700">{msg.message}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Reply..."
                            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs"
                            value={newMessage}
                            onChange={e => setNewMessage(e.target.value)}
                          />
                          <button
                            onClick={() => handleSendMessage(p.id)}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* DEVELOPER */}
      {['l1', 'l2', 'l3'].includes(currentUser.role) && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Points" value={earnedPoints} color="blue" />
            <StatCard label="Earned" value={earnedPoints} color="green" />
            <StatCard label="Pending" value={pendingPoints} color="amber" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">My Tasks</h2>
              <div className="flex gap-2">
                <QuickLink href="/tasks" label="Task Board" color="blue" />
                <QuickLink href="/tasks/submit" label="Submit" color="gray" />
                {['l2', 'l3'].includes(currentUser.role) && (
                  <QuickLink href="/review" label="Review" color="purple" />
                )}
              </div>
            </div>
            {myTasks.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center">
                <p className="text-gray-500 mb-4">No enrolled tasks yet.</p>
                <QuickLink href="/tasks" label="Browse Task Board" color="blue" />
              </div>
            ) : (
              <div className="space-y-2">
                {myTasks.map(t => (
                  <div key={t.id} className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm text-gray-800">{t.title}</span>
                      {t.project_title && (
                        <span className="text-xs text-gray-400 ml-2">/ {t.project_title}</span>
                      )}
                      <div className="flex gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          t.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>{t.difficulty}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">{t.point_value} pts</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${taskStatusColors[t.status]}`}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADMIN */}
      {currentUser.role === 'admin' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-3">Platform Overview</h2>
            <div className="grid grid-cols-5 gap-3">
              <StatCard label="Total Projects" value={platformStats.totalProjects} color="blue" />
              <StatCard label="Active" value={platformStats.activeProjects} color="green" />
              <StatCard label="Pending" value={platformStats.pendingProjects} color="amber" />
              <StatCard label="Total Tasks" value={platformStats.totalTasks} color="purple" />
              <StatCard label="Pending Submissions" value={platformStats.pendingSubmissions} color="gray" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Recent Projects</h2>
              <div className="flex gap-2">
                <QuickLink href="/admin" label="Admin Dashboard" color="blue" />
                
              </div>
            </div>
            <div className="space-y-2">
              {recentProjects.map(p => (
                <div key={p.id} className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm text-gray-800">{p.title}</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${statusColors[p.status]}`}>{p.status}</span>
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">{p.priority}</span>
                    {p.status === 'finished' && (
                      <a href={`/archive/${p.id}`} className="text-xs text-teal-600 hover:underline">
                        Archive →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
