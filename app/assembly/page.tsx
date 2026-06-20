'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { approveSubmission, rejectSubmission } from '../../lib/services/reviews'
import { Project, Task } from '../../lib/types'

interface TaskWithDetails extends Task {
  submission?: {
    id: string
    github_url: string
    notes: string | null
    builder_name?: string
    builder_id?: string
  }
  review?: {
    decision: string
    feedback: string | null
    reviewer_name?: string
  }
}

interface ProjectWithTasks extends Project {
  tasks: TaskWithDetails[]
  subscriber_name?: string
  admin_feedback?: string | null
}

export default function AssemblyPage() {
  const { currentUser } = useUser()
  const [projects, setProjects] = useState<ProjectWithTasks[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectWithTasks | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<Record<string, string>>({})

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
        .in('status', ['active', 'in_review', 'ready_for_admin'])
        .order('created_at', { ascending: false })

      if (!allProjects) return

      const enriched = await Promise.all(
        allProjects.map(async project => {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('project_id', project.id)

          const { data: subscriber } = await supabase
            .from('users')
            .select('name')
            .eq('id', project.subscriber_id)
            .single()

          const tasksWithDetails = await Promise.all(
            (tasks ?? []).map(async task => {
              const { data: submission } = await supabase
                .from('submissions')
                .select('*')
                .eq('task_id', task.id)
                .in('status', ['pending', 'approved'])
                .order('submitted_at', { ascending: false })
                .limit(1)
                .maybeSingle()

              const { data: review } = await supabase
                .from('reviews')
                .select('*')
                .eq('task_id', task.id)
                .order('reviewed_at', { ascending: false })
                .limit(1)
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
                  builder_id: submission.builder_id,
                } : undefined,
                review: review ? {
                  decision: review.decision,
                  feedback: review.feedback,
                  reviewer_name: reviewerName,
                } : undefined,
              }
            })
          )

          return {
            ...project,
            tasks: tasksWithDetails,
            subscriber_name: subscriber?.name,
            admin_feedback: project.admin_feedback,
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

  async function handleApproveTask(submissionId: string, taskId: string) {
    if (!currentUser) return
    try {
      await approveSubmission(submissionId, currentUser.id, feedback[taskId])
      setMessage('Task approved')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve')
    }
  }

  async function handleRejectTask(submissionId: string, taskId: string) {
    if (!currentUser) return
    if (!feedback[taskId]) return setMessage('Please provide feedback before rejecting')
    try {
      await rejectSubmission(submissionId, currentUser.id, feedback[taskId])
      setFeedback(prev => ({ ...prev, [taskId]: '' }))
      setMessage('Task rejected, sent back to developer')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject')
    }
  }

  async function refreshProject() {
    if (!selectedProject) return
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', selectedProject.id)

    const tasksWithDetails = await Promise.all(
      (tasks ?? []).map(async task => {
        const { data: submission } = await supabase
          .from('submissions')
          .select('*')
          .eq('task_id', task.id)
          .in('status', ['pending', 'approved'])
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const { data: review } = await supabase
          .from('reviews')
          .select('*')
          .eq('task_id', task.id)
          .order('reviewed_at', { ascending: false })
          .limit(1)
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
            builder_id: submission.builder_id,
          } : undefined,
          review: review ? {
            decision: review.decision,
            feedback: review.feedback,
            reviewer_name: reviewerName,
          } : undefined,
        }
      })
    )

    const updatedProject = { ...selectedProject, tasks: tasksWithDetails }
    setSelectedProject(updatedProject)
    setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p))
  }

  async function handleResetToReview() {
    if (!selectedProject) return
    try {
      await supabase
        .from('point_transactions')
        .update({ status: 'cancelled' })
        .eq('project_id', selectedProject.id)
        .eq('status', 'pending')

      const approvedTasks = selectedProject.tasks.filter(t => t.status === 'approved')
      await Promise.all(
        approvedTasks.map(async t => {
          await supabase
            .from('tasks')
            .update({ status: 'submitted', updated_at: new Date().toISOString() })
            .eq('id', t.id)
          await supabase
            .from('submissions')
            .update({ status: 'pending', updated_at: new Date().toISOString() })
            .eq('task_id', t.id)
            .eq('status', 'approved')
        })
      )
      setMessage('All tasks reset to submitted, available for review again')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reset tasks')
    }
  }
  async function handleMarkReady() {
    if (!selectedProject) return
    const allApproved = selectedProject.tasks.length > 0 &&
      selectedProject.tasks.every(t => t.status === 'approved')
    if (!allApproved) return setMessage('All tasks must be approved before marking ready for admin')

    try {
      await supabase
        .from('projects')
        .update({ status: 'ready_for_admin', updated_at: new Date().toISOString(), admin_feedback: null })
        .eq('id', selectedProject.id)

      const taskCount = selectedProject.tasks.length
      await supabase.from('point_transactions').insert({
        user_id: currentUser!.id,
        project_id: selectedProject.id,
        type: 'assemble',
        amount: taskCount * 10,
        status: 'pending',
        description: `L3 assembly payout: ${taskCount} tasks × 10 pts`,
      })
      // await supabase.rpc('increment_points', { uid: currentUser!.id, pts: taskCount * 10 })

      setMessage(`Project marked as ready for admin. You earned ${taskCount * 10} assembly points.`)
      const updated = { ...selectedProject, status: 'ready_for_admin' as const, admin_feedback: null }
      setSelectedProject(updated)
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updated : p))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to update project')
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (currentUser.role !== 'l3') return <div className="p-8 text-red-500">Only L3 leads can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  const statusColors: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    in_review: 'bg-yellow-100 text-yellow-700',
    ready_for_admin: 'bg-teal-100 text-teal-700',
  }

  const taskStatusColors: Record<string, string> = {
    open: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    submitted: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Assembly</h1>
      <p className="text-gray-500 text-sm mb-6">Review tasks and mark projects ready for admin deployment.</p>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* Project List */}
        <div>
          <h2 className="font-semibold text-lg mb-3">Projects</h2>
          <div className="space-y-2">
            {projects.length === 0 && (
              <p className="text-gray-400 text-sm">No active projects.</p>
            )}
            {projects.map(p => {
              const allApproved = p.tasks.length > 0 && p.tasks.every(t => t.status === 'approved')
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
                    {allApproved && p.status !== 'ready_for_admin' && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">✓ ready</span>
                    )}
                    {p.admin_feedback && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">⚠ sent back</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {p.tasks.filter(t => t.status === 'approved').length}/{p.tasks.length} tasks approved
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Project Detail */}
        <div className="col-span-2">
          {!selectedProject ? (
            <p className="text-gray-500">Select a project to review.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-lg">{selectedProject.title}</h2>
                  <div className="flex gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[selectedProject.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {selectedProject.status}
                    </span>
                    {selectedProject.subscriber_name && (
                      <span className="text-xs text-gray-400">Subscriber: {selectedProject.subscriber_name}</span>
                    )}
                  </div>
                  {selectedProject.admin_feedback && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <p className="text-xs font-bold text-red-600 mb-0.5">⚠ Sent back by Admin:</p>
                      <p className="text-xs text-red-700">{selectedProject.admin_feedback}</p>
                    </div>
                  )}
                </div>
                {selectedProject.status !== 'ready_for_admin' && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleMarkReady}
                      className="px-4 py-2 bg-teal-600 text-white text-sm rounded hover:bg-teal-700"
                    >
                      ✓ Mark Ready for Admin
                    </button>
                    <button
                      onClick={handleResetToReview}
                      className="px-4 py-2 bg-orange-500 text-white text-sm rounded hover:bg-orange-600"
                    >
                      ↺ Reset All to Review
                    </button>
                  </div>
                )}
                {selectedProject.status === 'ready_for_admin' && (
                  <span className="text-sm text-teal-600 font-medium">✓ Submitted to Admin</span>
                )}
              </div>

              {/* Task list */}
              <div className="space-y-3">
                {selectedProject.tasks.map(task => (
                  <div key={task.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-4 py-3 flex items-start justify-between">
                      <div>
                        <span className="font-medium text-sm">{task.title}</span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                          task.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>{task.difficulty}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${taskStatusColors[task.status]}`}>
                        {task.status}
                      </span>
                    </div>

                    {task.dod_criteria && (
                      <div className="px-4 pb-2">
                        <p className="text-xs text-amber-700">DoD: {task.dod_criteria}</p>
                      </div>
                    )}

                    {task.submission && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Submission</p>
                        <p className="text-xs text-gray-600">Builder: {task.submission.builder_name ?? 'Unknown'}</p>
                        <a
                          href={task.submission.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline block mt-0.5"
                        >
                          {task.submission.github_url}
                        </a>
                        {task.submission.notes && (
                          <p className="text-xs text-gray-500 mt-1">Notes: {task.submission.notes}</p>
                        )}
                      </div>
                    )}

                    {task.review && (
                      <div className="px-4 py-2 bg-green-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Previous Review</p>
                        <p className="text-xs text-gray-600">Reviewer: {task.review.reviewer_name ?? 'Unknown'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          task.review.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {task.review.decision}
                        </span>
                        {task.review.feedback && (
                          <p className="text-xs text-gray-500 mt-1">Feedback: {task.review.feedback}</p>
                        )}
                      </div>
                    )}

                    {/* L3 review actions - only show for submitted tasks with a pending submission */}
                    {task.submission && task.status === 'submitted' && task.submission.builder_id !== currentUser.id && (
                      <div className="px-4 py-3 border-t border-gray-100 bg-white">
                        <input
                          type="text"
                          placeholder="Feedback (required for rejection)"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2"
                          value={feedback[task.id] ?? ''}
                          onChange={e => setFeedback(prev => ({ ...prev, [task.id]: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproveTask(task.submission!.id, task.id)}
                            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleRejectTask(task.submission!.id, task.id)}
                            className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {!task.submission && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs text-gray-400 italic">No submission yet</p>
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
