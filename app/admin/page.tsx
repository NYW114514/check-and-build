'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { getProjects, createProject, updateProjectStatus } from '../../lib/services/projects'
import { getTasksByProject, createTask } from '../../lib/services/tasks'
import { Project, Task, User } from '../../lib/types'
import { getUsers } from '../../lib/services/users'
import { supabase } from '../../lib/supabase'

interface TaskWithDetails extends Task {
  submission?: {
    id: string
    github_url: string
    notes: string | null
    builder_name?: string
  }
  review?: {
    decision: string
    feedback: string | null
    reviewer_name?: string
  }
}

export default function AdminPage() {
  const { currentUser } = useUser()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<TaskWithDetails[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [sendBackReason, setSendBackReason] = useState('')
  const [developerList, setDeveloperList] = useState<User[]>([])
  const [taskEnrollments, setTaskEnrollments] = useState<Record<string, string[]>>({})
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTask, setEditTask] = useState({
    title: '',
    description: '',
    dod_criteria: '',
    difficulty: 'basic' as 'basic' | 'advanced',
  })

  const [newProject, setNewProject] = useState({
    title: '',
    description: '',
    priority: 'standard' as 'standard' | 'high' | 'critical',
    subscriber_id: '',
    main_contact_id: '',
    intake_payload: '',
  })

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    dod_criteria: '',
    difficulty: 'basic' as 'basic' | 'advanced',
  })

  useEffect(() => {
    Promise.all([getProjects(), getUsers()])
      .then(([p, u]) => {
        setProjects(p)
        setUsers(u)
        setDeveloperList(u.filter(user => ['l1', 'l2', 'l3'].includes(user.role)))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleSelectProject(project: Project) {
    setSelectedProject(project)
    const rawTasks = await getTasksByProject(project.id)
    const enriched = await Promise.all(
      rawTasks.map(async task => {
        const { data: submission } = await supabase
          .from('submissions')
          .select('*')
          .eq('task_id', task.id)
          .eq('status', 'approved')
          .maybeSingle()

        const { data: review } = await supabase
          .from('reviews')
          .select('*')
          .eq('task_id', task.id)
          .eq('decision', 'approved')
          .maybeSingle()

        let builderName, reviewerName
        if (submission) {
          const { data: builder } = await supabase
            .from('users').select('name').eq('id', submission.builder_id).single()
          builderName = builder?.name
        }
        if (review) {
          const { data: reviewer } = await supabase
            .from('users').select('name').eq('id', review.reviewer_id).single()
          reviewerName = reviewer?.name
        }

        return {
          ...task,
          submission: submission ? {
            id: submission.id,
            github_url: submission.github_url,
            notes: submission.notes,
            builder_name: builderName,
          } : undefined,
          review: review ? {
            decision: review.decision,
            feedback: review.feedback,
            reviewer_name: reviewerName,
          } : undefined,
        }
      })
    )

    setTasks(enriched)

    const enrollmentMap: Record<string, string[]> = {}
    enriched.forEach(t => {
      enrollmentMap[t.id] = []
    })
    const { data: allEnrollments } = await supabase
      .from('task_enrollments')
      .select('task_id, user_id')
      .in('task_id', enriched.map(t => t.id))
    allEnrollments?.forEach(e => {
      if (enrollmentMap[e.task_id]) {
        enrollmentMap[e.task_id].push(e.user_id)
      }
    })
    setTaskEnrollments(enrollmentMap)
  }

  function getNextStatus(current: Project['status']): Project['status'] | null {
    const flow: Record<string, Project['status']> = {
      pending: 'active',
      active: 'in_review',
      in_review: 'ready_for_admin',
      ready_for_admin: 'pending_deployment',
      pending_deployment: 'finished',
    }
    return flow[current] ?? null
  }

  async function handleUpdateStatus() {
    if (!selectedProject) return
    const nextStatus = getNextStatus(selectedProject.status)
    if (!nextStatus) return setMessage('Project is already finished')

    if (nextStatus === 'in_review') {
      const hasProgress = tasks.some(t => t.status === 'submitted' || t.status === 'approved')
      if (!hasProgress) return setMessage('Cannot move to review before any task is submitted or approved')
    }

    if (nextStatus === 'ready_for_admin' || nextStatus === 'pending_deployment') {
      const allApproved = tasks.length > 0 && tasks.every(t => t.status === 'approved')
      if (!allApproved) return setMessage('All tasks must be approved before proceeding')
    }

    try {
      if (nextStatus === 'finished') {
        const { data: pendingTxns } = await supabase
          .from('point_transactions')
          .select('user_id, amount')
          .eq('project_id', selectedProject.id)
          .eq('status', 'pending')

        await supabase
          .from('point_transactions')
          .update({ status: 'earned' })
          .eq('project_id', selectedProject.id)
          .eq('status', 'pending')

        if (pendingTxns) {
          const userTotals: Record<string, number> = {}
          pendingTxns.forEach(t => {
            userTotals[t.user_id] = (userTotals[t.user_id] ?? 0) + t.amount
          })
          await Promise.all(
            Object.entries(userTotals).map(([uid, pts]) =>
              supabase.rpc('increment_points', { uid, pts })
            )
          )
        }
      }

      const updated = await updateProjectStatus(selectedProject.id, nextStatus)
      setSelectedProject(updated)
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
      setMessage(`Project status updated to ${nextStatus}`)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  async function handleCreateProject() {
    if (!newProject.title) return setMessage('Project title is required')
    if (!newProject.subscriber_id) return setMessage('Subscriber is required')

    let parsedPayload = null
    if (newProject.intake_payload.trim()) {
      try {
        parsedPayload = JSON.parse(newProject.intake_payload)
      } catch {
        return setMessage('Invalid JSON in intake payload')
      }
    }

    try {
      const project = await createProject({
        title: newProject.title,
        description: newProject.description,
        subscriber_id: newProject.subscriber_id,
        main_contact_id: newProject.main_contact_id || null,
        priority: newProject.priority,
        status: 'pending',
        intake_payload: parsedPayload,
      })
      setProjects(prev => [project, ...prev])
      setNewProject({ title: '', description: '', priority: 'standard', subscriber_id: '', main_contact_id: '', intake_payload: '' })
      setShowCreateProject(false)
      setMessage('Project created')
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to create project')
    }
  }

  async function handleCreateTask() {
    if (!selectedProject) return
    if (!newTask.title) return setMessage('Task title is required')
    try {
      const task = await createTask({
        project_id: selectedProject.id,
        title: newTask.title,
        description: newTask.description,
        dod_criteria: newTask.dod_criteria,
        difficulty: newTask.difficulty,
        status: 'open',
        point_value: 10,
        max_developers: 3,
      })
      setTasks(prev => [...prev, task])
      setNewTask({ title: '', description: '', dod_criteria: '', difficulty: 'basic' })
      setMessage('Task created')
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to create task')
    }
  }

  async function handleSaveTask(taskId: string) {
  try {
    await supabase
      .from('tasks')
      .update({
        title: editTask.title,
        description: editTask.description,
        dod_criteria: editTask.dod_criteria,
        difficulty: editTask.difficulty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...editTask } : t))
    setEditingTaskId(null)
    setMessage('Task updated')
  } catch (e: unknown) {
    setMessage(e instanceof Error ? e.message : 'Failed to update task')
  }
}

async function handleDeleteTask(taskId: string) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return
  if (task.status !== 'open') return setMessage('Can only delete open tasks with no enrollments')
  try {
    await supabase.from('tasks').delete().eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setMessage('Task deleted')
  } catch (e: unknown) {
    setMessage(e instanceof Error ? e.message : 'Failed to delete task')
  }
}

  async function handleAssignTask(taskId: string, userId: string) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return

  const assignedUser = developerList.find(u => u.id === userId)
  if (!assignedUser) return

  if (assignedUser.role === 'l1' && task.difficulty === 'advanced') {
    return setMessage('L1 developers cannot be assigned to advanced tasks')
  }

  const currentEnrollments = taskEnrollments[taskId] ?? []
  if (currentEnrollments.length >= task.max_developers) {
    return setMessage(`Task is full (max ${task.max_developers} developers)`)
  }

  if (currentEnrollments.includes(userId)) {
    return setMessage('Developer is already assigned to this task')
  }

  try {
    await supabase.from('task_enrollments').insert({ task_id: taskId, user_id: userId })
    await supabase.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', taskId)
    setTaskEnrollments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), userId] }))
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' as const } : t))
    setMessage('Developer assigned successfully')
  } catch (e: unknown) {
    setMessage(e instanceof Error ? e.message : 'Failed to assign')
  }
}

async function handleRemoveTask(taskId: string, userId: string) {
  const task = tasks.find(t => t.id === taskId)
  if (!task) return

  if (task.status === 'submitted' || task.status === 'approved') {
    return setMessage('Cannot remove: this task already has a submission')
  }

  try {
    await supabase.from('task_enrollments').delete().eq('task_id', taskId).eq('user_id', userId)
    const remaining = (taskEnrollments[taskId] ?? []).filter(id => id !== userId)
    if (remaining.length === 0) {
      await supabase.from('tasks').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', taskId)
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'open' as const } : t))
    }
    setTaskEnrollments(prev => ({ ...prev, [taskId]: remaining }))
    setMessage('Developer removed from task')
  } catch (e: unknown) {
    setMessage(e instanceof Error ? e.message : 'Failed to remove')
  }
}

  const subscribers = users.filter(u => u.role === 'subscriber')
  const mainContacts = users.filter(u => u.role === 'admin' || u.role === 'l3')

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

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (currentUser.role !== 'admin') return <div className="p-8 text-red-500">Only admins can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  const nextStatus = selectedProject ? getNextStatus(selectedProject.status) : null
  const isReadyForFinalAction = selectedProject?.status === 'ready_for_admin' || selectedProject?.status === 'pending_deployment'

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>
      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* Left: Project List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">Projects</h2>
            <button
              onClick={() => setShowCreateProject(!showCreateProject)}
              className="text-xs px-3 py-1 bg-gray-800 text-white rounded hover:bg-gray-900"
            >
              {showCreateProject ? 'Cancel' : '+ New'}
            </button>
          </div>

          {showCreateProject && (
            <div className="border border-dashed border-gray-300 rounded-lg p-3 mb-3 bg-white space-y-2">
              <input
                type="text"
                placeholder="Project title *"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={newProject.title}
                onChange={e => setNewProject({ ...newProject, title: e.target.value })}
              />
              <textarea
                placeholder="Description"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                rows={2}
                value={newProject.description}
                onChange={e => setNewProject({ ...newProject, description: e.target.value })}
              />
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={newProject.priority}
                onChange={e => setNewProject({ ...newProject, priority: e.target.value as 'standard' | 'high' | 'critical' })}
              >
                <option value="standard">Standard</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={newProject.subscriber_id}
                onChange={e => setNewProject({ ...newProject, subscriber_id: e.target.value })}
              >
                <option value="">Select subscriber *</option>
                {subscribers.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                value={newProject.main_contact_id}
                onChange={e => setNewProject({ ...newProject, main_contact_id: e.target.value })}
              >
                <option value="">Select main contact (optional)</option>
                {mainContacts.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
              <textarea
                placeholder='Intake payload (JSON, optional)'
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                rows={3}
                value={newProject.intake_payload}
                onChange={e => setNewProject({ ...newProject, intake_payload: e.target.value })}
              />
              <button
                onClick={handleCreateProject}
                className="w-full py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Create Project
              </button>
            </div>
          )}

          <div className="space-y-2">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => handleSelectProject(p)}
                className={`border rounded-lg p-3 cursor-pointer hover:border-blue-400 ${
                  selectedProject?.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="font-medium text-sm">{p.title}</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColors[p.status]}`}>{p.status}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">{p.priority}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Project Detail */}
        <div className="col-span-2">
          {!selectedProject ? (
            <p className="text-gray-500">Select a project to manage.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-lg">{selectedProject.title}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded ${statusColors[selectedProject.status]}`}>
                    {selectedProject.status}
                  </span>
                </div>
                <div className="flex gap-2">
                  {nextStatus && (
                    <button
                      onClick={handleUpdateStatus}
                      className={`px-4 py-2 text-white text-sm rounded ${
                        isReadyForFinalAction
                          ? 'bg-teal-600 hover:bg-teal-700'
                          : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      → {nextStatus.replace(/_/g, ' ')}
                    </button>
                  )}
                  {(selectedProject.status === 'ready_for_admin' || selectedProject.status === 'pending_deployment') && (
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Reason for sending back..."
                        className="border border-gray-300 rounded px-3 py-2 text-sm w-64"
                        value={sendBackReason}
                        onChange={e => setSendBackReason(e.target.value)}
                      />
                      <button
                        onClick={async () => {
                          const backTo = 'in_review'
                          await supabase
                            .from('projects')
                            .update({ admin_feedback: sendBackReason || null })
                            .eq('id', selectedProject.id)
                          await supabase
                            .from('point_transactions')
                            .update({ status: 'cancelled' })
                            .eq('project_id', selectedProject.id)
                            .eq('status', 'pending')
                          const updated = await updateProjectStatus(selectedProject.id, backTo)
                          setSelectedProject(updated)
                          setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))
                          setMessage(`Project sent back to ${backTo.replace(/_/g, ' ')}${sendBackReason ? `: ${sendBackReason}` : ''}`)
                          setSendBackReason('')
                        }}
                        className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 shrink-0"
                      >
                        ✕ Send Back
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Intake Payload */}
              {selectedProject.intake_payload && (
                <div className="mb-4 bg-gray-50 border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-bold text-gray-500">INTAKE PAYLOAD</p>
                    <p className="text-xs text-gray-400">This payload contains subscriber requirements. Do not share outside the team.</p>
                  </div>
                  <pre className="text-xs text-gray-700 overflow-auto max-h-96">
                    {JSON.stringify(selectedProject.intake_payload, null, 2)}
                  </pre>
                </div>
              )}

              {/* Task Progress */}
              <div className="mb-2 flex gap-3 text-xs">
                {['open', 'in_progress', 'submitted', 'approved'].map(s => (
                  <span key={s} className={`px-2 py-1 rounded ${taskStatusColors[s]}`}>
                    {s}: {tasks.filter(t => t.status === s).length}
                  </span>
                ))}
              </div>

              <div className="flex justify-end mb-3">
                <button
                  disabled
                  className="text-xs px-3 py-1.5 border border-gray-200 text-gray-400 rounded cursor-not-allowed"
                >
                  ✦ Suggest Tasks (coming soon)
                </button>
              </div>

              {/* Task List with submission + review details */}
              <div className="space-y-3 mb-4">
                {tasks.map(t => (
                  <div key={t.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-4 py-3 flex items-start justify-between">
                      <div>
                        <span className="font-medium text-sm">{t.title}</span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                          t.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>{t.difficulty}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${taskStatusColors[t.status]}`}>
                          {t.status}
                        </span>
                        {(t.status === 'open' || t.status === 'in_progress') && selectedProject.status !== 'finished' && (
                          <button
                            onClick={() => {
                              setEditingTaskId(t.id)
                              setEditTask({
                                title: t.title,
                                description: t.description ?? '',
                                dod_criteria: t.dod_criteria ?? '',
                                difficulty: t.difficulty,
                              })
                            }}
                            className="text-xs px-2 py-1 border border-gray-200 text-gray-500 rounded hover:bg-gray-50"
                          >
                            Edit
                          </button>
                        )}
                        {t.status === 'open' && (taskEnrollments[t.id] ?? []).length === 0 && (
                          <button
                            onClick={() => handleDeleteTask(t.id)}
                            className="text-xs px-2 py-1 border border-red-200 text-red-500 rounded hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {t.dod_criteria && (
                      <div className="px-4 pb-2">
                        <p className="text-xs text-amber-700">DoD: {t.dod_criteria}</p>
                      </div>
                    )}

                    {editingTaskId === t.id && (
                      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-2">
                        <input
                          type="text"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          value={editTask.title}
                          onChange={e => setEditTask({ ...editTask, title: e.target.value })}
                          placeholder="Task title"
                        />
                        <textarea
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          rows={2}
                          value={editTask.description}
                          onChange={e => setEditTask({ ...editTask, description: e.target.value })}
                          placeholder="Description"
                        />
                        <textarea
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          rows={2}
                          value={editTask.dod_criteria}
                          onChange={e => setEditTask({ ...editTask, dod_criteria: e.target.value })}
                          placeholder="Definition of Done"
                        />
                        <select
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          value={editTask.difficulty}
                          onChange={e => setEditTask({ ...editTask, difficulty: e.target.value as 'basic' | 'advanced' })}
                        >
                          <option value="basic">Basic</option>
                          <option value="advanced">Advanced</option>
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveTask(t.id)}
                            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingTaskId(null)}
                            className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {t.submission && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Submission</p>
                        <p className="text-xs text-gray-600">Builder: {t.submission.builder_name ?? 'Unknown'}</p>
                        
                        <a
                          href={t.submission.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline block mt-0.5"
                        >
                          {t.submission.github_url}
                        </a>
                        {t.submission.notes && (
                          <p className="text-xs text-gray-500 mt-1">Notes: {t.submission.notes}</p>
                        )}
                      </div>
                    )}

                    {t.review && (
                      <div className="px-4 py-2 bg-green-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Review</p>
                        <p className="text-xs text-gray-600">Reviewer: {t.review.reviewer_name ?? 'Unknown'}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                          {t.review.decision}
                        </span>
                        {t.review.feedback && (
                          <p className="text-xs text-gray-500 mt-1">Feedback: {t.review.feedback}</p>
                        )}
                      </div>
                    )}

                    {!t.submission && t.status === 'open' && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs text-gray-400 italic">No submission yet</p>
                      </div>
                    )}
                    {selectedProject.status !== 'finished' && (
                      <div className="px-4 py-2 border-t border-gray-100 bg-white">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-2">
                          Assigned ({(taskEnrollments[t.id] ?? []).length}/{t.max_developers})
                        </p>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {(taskEnrollments[t.id] ?? []).map(uid => {
                            const dev = developerList.find(d => d.id === uid)
                            return dev ? (
                              <span key={uid} className="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded">
                                {dev.name} ({dev.role})
                                {(t.status === 'open' || t.status === 'in_progress') && (
                                  <button
                                    onClick={() => handleRemoveTask(t.id, uid)}
                                    className="text-red-400 hover:text-red-600 ml-1"
                                  >
                                    ✕
                                  </button>
                                )}
                              </span>
                            ) : null
                          })}
                        </div>
                        {(taskEnrollments[t.id] ?? []).length < t.max_developers && (t.status === 'open' || t.status === 'in_progress') && (
                          <div className="flex gap-2">
                            <select
                              className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
                              defaultValue=""
                              onChange={e => {
                                if (e.target.value) {
                                  handleAssignTask(t.id, e.target.value)
                                  e.target.value = ''
                                }
                              }}
                            >
                              <option value="">Assign developer...</option>
                              {developerList
                                .filter(d => !(taskEnrollments[t.id] ?? []).includes(d.id))
                                .map(d => (
                                  <option key={d.id} value={d.id}>
                                    {d.name} ({d.role})
                                  </option>
                                ))
                              }
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Create Task Form - only show for non-finished projects */}
              {selectedProject.status === 'pending' && (
                <div className="border border-dashed border-gray-300 rounded-lg p-4 bg-white">
                  <h3 className="font-medium text-sm mb-3">Add New Task</h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Task title *"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      value={newTask.title}
                      onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                    />
                    <textarea
                      placeholder="Description"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      rows={2}
                      value={newTask.description}
                      onChange={e => setNewTask({ ...newTask, description: e.target.value })}
                    />
                    <textarea
                      placeholder="Definition of Done"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      rows={2}
                      value={newTask.dod_criteria}
                      onChange={e => setNewTask({ ...newTask, dod_criteria: e.target.value })}
                    />
                    <select
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      value={newTask.difficulty}
                      onChange={e => setNewTask({ ...newTask, difficulty: e.target.value as 'basic' | 'advanced' })}
                    >
                      <option value="basic">Basic</option>
                      <option value="advanced">Advanced</option>
                    </select>
                    <button
                      onClick={handleCreateTask}
                      className="w-full py-2 bg-gray-800 text-white text-sm rounded hover:bg-gray-900"
                    >
                      Create Task
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
