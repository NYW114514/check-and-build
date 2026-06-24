'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { enrollTask } from '../../lib/services/tasks'
import { claimProject } from '../../lib/services/projects'
import { Project, Task } from '../../lib/types'

interface TaskWithEnrollment extends Task {
  enrolledDevelopers?: { id: string; name: string; role: string }[]
  isEnrolled?: boolean
  enrolledCount?: number
}

interface ProjectWithDetails extends Project {
  subscriber_name?: string
  tasks: TaskWithEnrollment[]
}

export default function ProjectsPage() {
  const { currentUser } = useUser()
  const [projects, setProjects] = useState<ProjectWithDetails[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    loadProjects()
  }, [currentUser?.id])

  async function loadProjects() {
    setLoading(true)
    try {
      const { data: allProjects } = await supabase
        .from('projects')
        .select('*')
        .in('status', ['active', 'in_review', 'ready_for_admin', 'pending_deployment', 'finished'])
        .order('created_at', { ascending: false })

      if (!allProjects) return

      const enriched = await Promise.all(
        allProjects.map(async project => {
          const { data: subscriber } = await supabase
            .from('users')
            .select('name')
            .eq('id', project.subscriber_id)
            .single()

          const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('project_id', project.id)
            .order('created_at', { ascending: true })

          const tasksWithDetails = await Promise.all(
            (tasks ?? []).map(async task => {
              const { data: enrollments } = await supabase
                .from('task_enrollments')
                .select('user_id')
                .eq('task_id', task.id)

              const developerIds = (enrollments ?? []).map(e => e.user_id)
              let enrolledDevelopers: { id: string; name: string; role: string }[] = []

              if (developerIds.length > 0) {
                const { data: devs } = await supabase
                  .from('users')
                  .select('id, name, role')
                  .in('id', developerIds)
                enrolledDevelopers = devs ?? []
              }

              return {
                ...task,
                enrolledDevelopers,
                enrolledCount: developerIds.length,
                isEnrolled: developerIds.includes(currentUser!.id),
              }
            })
          )

          return {
            ...project,
            subscriber_name: subscriber?.name,
            tasks: tasksWithDetails,
          }
        })
      )

      setProjects(enriched)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleEnroll(taskId: string) {
    if (!currentUser) return
    try {
      await enrollTask(taskId, currentUser.id)
      setMessage('Enrolled successfully')
      await refreshSelectedProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to enroll')
    }
  }

  async function handleClaimProject(projectId: string) {
    if (!currentUser) return
    try {
      const updated = await claimProject(projectId, currentUser.id)
      setMessage('Project claimed — you are now the L3 owner')
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...updated } : p))
      setSelectedProject(prev => prev?.id === projectId ? { ...prev, ...updated } : prev)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to claim project')
    }
  }

  async function refreshSelectedProject() {
    if (!selectedProject) return
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', selectedProject.id)
      .order('created_at', { ascending: true })

    const tasksWithDetails = await Promise.all(
      (tasks ?? []).map(async task => {
        const { data: enrollments } = await supabase
          .from('task_enrollments')
          .select('user_id')
          .eq('task_id', task.id)

        const developerIds = (enrollments ?? []).map(e => e.user_id)
        let enrolledDevelopers: { id: string; name: string; role: string }[] = []

        if (developerIds.length > 0) {
          const { data: devs } = await supabase
            .from('users')
            .select('id, name, role')
            .in('id', developerIds)
          enrolledDevelopers = devs ?? []
        }

        return {
          ...task,
          enrolledDevelopers,
          enrolledCount: developerIds.length,
          isEnrolled: developerIds.includes(currentUser!.id),
        }
      })
    )

    const updated = { ...selectedProject, tasks: tasksWithDetails }
    setSelectedProject(updated)
    setProjects(prev => prev.map(p => p.id === selectedProject.id ? updated : p))
  }

  if (!currentUser) {
    return <div className="p-8 text-gray-500">Please select a user first.</div>
  }
  if (!['l1', 'l2', 'l3'].includes(currentUser.role)) {
    return <div className="p-8 text-red-500">Only developers can access this page.</div>
  }
  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  const statusColors: Record<string, string> = {
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
    pending_final: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Projects</h1>
      <p className="text-gray-500 text-sm mb-6">Browse projects and enroll in tasks.</p>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* Project List */}
        <div>
          <h2 className="font-semibold text-lg mb-3">Active Projects</h2>
          {projects.length === 0 ? (
            <p className="text-gray-400 text-sm">No active projects.</p>
          ) : (
            <div className="space-y-2">
              {projects.map(p => {
                const myTaskCount = p.tasks.filter(t => t.isEnrolled).length
                const isOwner = p.l3_owner_id === currentUser.id
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProject(p)}
                    className={`border rounded-lg p-3 cursor-pointer hover:border-blue-400 ${
                      selectedProject?.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="font-medium text-sm">{p.title}</div>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColors[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {p.status}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                        {p.priority}
                      </span>
                      {isOwner && (
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                          L3 Owner
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {p.tasks.length} tasks
                      {myTaskCount > 0 && (
                        <span className="ml-2 text-blue-600">· {myTaskCount} assigned to you</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Project Detail */}
        <div className="col-span-2">
          {!selectedProject ? (
            <p className="text-gray-500">Select a project to view details.</p>
          ) : (
            <>
              <div className="mb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-lg">{selectedProject.title}</h2>
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColors[selectedProject.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {selectedProject.status}
                      </span>
                      <span className="text-xs text-gray-400">
                        Subscriber: {selectedProject.subscriber_name ?? 'Unknown'}
                      </span>
                      {selectedProject.contact_email && (
                        <span className="text-xs text-gray-400">
                          Contact: {selectedProject.contact_email}
                        </span>
                      )}
                    </div>
                    {selectedProject.description && (
                      <p className="text-sm text-gray-600 mt-2">{selectedProject.description}</p>
                    )}
                  </div>

                  {/* L3 Claim button */}
                  {currentUser.role === 'l3' && !selectedProject.l3_owner_id && selectedProject.status === 'active' && (
                    <button
                      onClick={() => handleClaimProject(selectedProject.id)}
                      className="ml-4 shrink-0 px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                    >
                      Claim Project
                    </button>
                  )}
                  {selectedProject.l3_owner_id === currentUser.id && (
                    <span className="ml-4 shrink-0 text-xs px-3 py-1.5 bg-purple-100 text-purple-700 rounded">
                      ✓ You own this project
                    </span>
                  )}
                </div>
              </div>

              {/* Task progress summary */}
              <div className="mb-4 flex gap-3 text-xs flex-wrap">
                {['open', 'in_progress', 'submitted', 'pending_final', 'approved'].map(s => (
                  <span key={s} className={`px-2 py-1 rounded ${taskStatusColors[s]}`}>
                    {s}: {selectedProject.tasks.filter(t => t.status === s).length}
                  </span>
                ))}
              </div>

              {/* Task List */}
              <div className="space-y-3">
                {selectedProject.tasks.map(task => (
                  <div
                    key={task.id}
                    className={`border rounded-lg bg-white overflow-hidden ${
                      task.isEnrolled ? 'border-blue-300' : 'border-gray-200'
                    }`}
                  >
                    <div className="px-4 py-3 flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{task.title}</span>
                          {task.isEnrolled && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">You</span>
                          )}
                        </div>
                        <div className="flex gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            task.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                          }`}>{task.difficulty}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                            {task.point_value} pts
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${taskStatusColors[task.status]}`}>
                          {task.status}
                        </span>
                        <span className="text-xs text-gray-400">
                          {task.enrolledCount ?? 0}/{task.max_developers} enrolled
                        </span>
                        {/* Enroll button */}

                        {!task.isEnrolled && (task.enrolledCount ?? 0) < task.max_developers && selectedProject.status === 'active' && (
                          (task.enrolledCount ?? 0) < task.max_developers ? (
                            <button
                              onClick={() => handleEnroll(task.id)}
                              className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                            >
                              Enroll
                            </button>
                          ) : (
                            <span className="px-3 py-1 bg-gray-100 text-gray-400 text-xs rounded">Full</span>
                          )
                        )}
                        {task.isEnrolled && (
                          <span className="px-3 py-1 bg-green-100 text-green-700 text-xs rounded">✓ Enrolled</span>
                        )}
                      </div>
                    </div>

                    {task.description && (
                      <div className="px-4 pb-2">
                        <p className="text-xs text-gray-500">{task.description}</p>
                      </div>
                    )}

                    {task.dod_criteria && (
                      <div className="px-4 pb-2">
                        <p className="text-xs text-amber-700">DoD: {task.dod_criteria}</p>
                      </div>
                    )}

                    {task.due_at && (
                      <div className="px-4 pb-2 flex gap-4 text-xs text-gray-400">
                        <span>Started: {new Date(task.first_enrolled_at!).toLocaleDateString()}</span>
                        <span>Due: {new Date(task.due_at).toLocaleDateString()}</span>
                      </div>
                    )}

                    {task.enrolledDevelopers && task.enrolledDevelopers.length > 0 && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">
                          Assigned ({task.enrolledDevelopers.length}/{task.max_developers})
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {task.enrolledDevelopers.map(dev => (
                            <span
                              key={dev.id}
                              className={`text-xs px-2 py-0.5 rounded ${
                                dev.id === currentUser.id
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {dev.name} ({dev.role})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
